# 設計: プラグインの資格情報を EDC アカウントのトークンにする

- 工程: 2. 設計。状態: **承認済み(ユーザー、2026-10-21)**。要求は [requirements.md](requirements.md)
- 実装(2026-10-21): 10 節のテストはすべて `plugin/mcp/test/` にある(`npm test`)。本番の EDC アカウントで、認可の引数が受け付けられること(`/auth` が登録・ログインの画面へ進む)、`resource` が違えば `invalid_target` と `iss` つきで戻ることを確かめた
- 前提: requirements.md の Q-1〜Q-3 の決定(EDC アカウントだけ、スコープ 3 つ、鍵束がなければ 600 のファイル)

## 1. 置き場所

| ファイル | 役目 |
|---|---|
| `plugin/mcp/edc-auth.mjs`(新) | 信頼の起点の定数、ログイン(ループバック・端末のフロー)、トークンの取り直し、ログアウト。依存なし(Node の標準だけ)。外とのやりとり(`fetch`・保存・時計・ブラウザ・ログ)は引数で受け、テストで差し替える |
| `plugin/mcp/token-store.mjs`(新) | 保存先(キーチェーン・Secret Service・DPAPI・ファイル)と、プロセスをまたぐ錠 |
| `plugin/mcp/launcher.mjs` | コマンド(`login`・`logout`・`check`・`status`)と、MCP サーバーの起動。`register`・`setup` と `.env` の読み込み、Google ログインは消す |
| `plugin/mcp/src/apiCall.ts`(新) | ツールの呼び出しのやり直し(401・500)と、エラーの文 |
| `plugin/mcp/src/server.ts` | `GoogleAuth`・`baseUrl`/`serviceAccountKey` の引数を消し、宛先を固定する |
| `plugin/mcp/defaults.json` | 消す(宛先・クライアントは `edc-auth.mjs` の定数) |
| `plugin/mcp/test/*.test.mjs`(新) | `node --test`。偽の認可サーバー(127.0.0.1)を立てて通しで確かめる |

依存: `google-auth-library` を外す。足すものはない(鍵束は OS の付属のコマンドを使い、ネイティブのモジュールを配布物に入れない)。

## 2. 信頼の起点(定数、REQ-P15)

| 名前 | 値 |
|---|---|
| `ISSUER` | `https://edc-account-366057354766.asia-east1.run.app` |
| エンドポイント | `{ISSUER}/auth`、`/token`、`/device/auth`、`/token/revocation`(2026-10-21 のメタデータで確かめた値。実行時にメタデータを取りに行かない) |
| `CLIENT_ID` | `edc-cli` |
| `RESOURCE` | `https://entertainment-design-catalog.web.app/v1` |
| `SCOPE` | `analyses:read analyses:write cases:read` |
| `API_BASE` | `https://entertainment-design-catalog.web.app`(`RESOURCE` から `/v1` を除いたもの。トークンを送ってよいのはここだけ。REQ-P12) |

環境変数・`.env` で変えられない。テストだけは `createAuth({ config })` で差し替える。

## 3. ログイン(REQ-P02・P13)

### 3.1 ブラウザ(既定、`node mcp/launcher.mjs login`)

1. `verifier` = 乱数 48 バイト(base64url)、`challenge` = SHA-256(base64url)、`state` = 乱数 16 バイト
2. `127.0.0.1` のポート 0 で待つ。`redirect_uri` = `http://127.0.0.1:{port}/callback`
3. `{ISSUER}/auth?response_type=code&client_id=edc-cli&redirect_uri=…&scope=…&resource=…&code_challenge=…&code_challenge_method=S256&state=…` をブラウザで開き、同じ URL を標準エラーに出す(この URL に秘密はない)
4. コールバック: `GET /callback` 以外は 404 で無視。`iss` = `ISSUER`(RFC 9207。なければ失敗)、`state` が一致、`error` があれば失敗(`error` の種類だけを出す)、`code` があること。応答の HTML には `Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`Content-Security-Policy: default-src 'none'`。1 回受けたら閉じる。5 分で切る
5. `POST /token`(`grant_type=authorization_code`、`code`、`redirect_uri`、`code_verifier`、`client_id`、`resource`)
6. 応答を確かめる(5 節)→ 保存(4 節)→ 古い Google ログインの片づけ(REQ-P05: `~/.config/edc/auth.json` があれば、その Google のリフレッシュトークンを `oauth2.googleapis.com/revoke` で失効させ、消す)→ 続けて `check`

未登録の人は、3 の画面の中で EDC アカウントの登録(S-02)に進む(REQ-P04)。

### 3.2 端末のフロー(`login --device`)

1. `POST /device/auth`(`client_id`、`scope`、`resource`)
2. `verification_uri_complete`(なければ `verification_uri` と `user_code`)を標準エラーに出す
3. `interval`(既定 5 秒)ごとに `POST /token`(`grant_type=urn:ietf:params:oauth:grant-type:device_code`、`device_code`、`client_id`、`resource`)。`authorization_pending` は続ける、`slow_down` は間隔を 5 秒延ばす、`expired_token`・`access_denied` は失敗。`expires_in`(既定 600 秒)で切る
4. 以降は 3.1 の 6 と同じ

## 4. 保存と錠(REQ-P10・P14)

保存するもの(1 つの値、JSON を base64url にしたもの):

```
{ v: 1, refreshToken, accessToken, expiresAt(ミリ秒), scope, savedAt }
```

| 保存先 | 選ぶ条件 | 書く | 読む | 消す |
|---|---|---|---|---|
| macOS のキーチェーン | `process.platform === "darwin"` | `security -i` の標準入力に `add-generic-password -U -s edc-agent-plugin -a edc-cli -w <値>`(値を引数に出さない) | `security find-generic-password -s … -a … -w` | `delete-generic-password` |
| Secret Service | Linux で `secret-tool` があり、`store` が通る | `secret-tool store --label="EDC" service edc-agent-plugin account edc-cli`(値は標準入力) | `secret-tool lookup …` | `secret-tool clear …` |
| DPAPI | Windows | PowerShell に標準入力で値を渡し、`ConvertFrom-SecureString`(利用者に結びつく)の結果を `~/.config/edc/token.dpapi`(600)に書く | 逆 | ファイルを消す |
| ファイル | 上のどれも使えないとき | `~/.config/edc/token.json`(フォルダ 700、ファイル 600、一時ファイルに書いて名前を変える) | 読む | 消す |

- 使った保存先は `status` と起動のログに出す(値は出さない)。ファイルのときは「鍵束がないため、権限 600 のファイルに保存」と出す(Q-3)
- 子プロセスは `execFile`(シェルを通さない)。標準エラーは捨てる(値が混ざらないように)

錠(プロセスをまたぐ):

- `~/.config/edc/token.lock` を `open(…, "wx")` で作れたら持っている。100 ミリ秒ごとに 25 秒まで待つ(持ち主の更新の通信は最長 20 秒)。30 秒より古い錠は、持ち主が落ちたとみなして消す
- アクセストークンを取り直すときは、錠の中で保存を**読み直し**、ほかのプロセスが更新済み(残り 60 秒より長い)ならそれを使う。そうでなければ更新して書き、錠を外す。これで同じリフレッシュトークンを二度使わない

## 5. トークンの取り直し(REQ-P03・P24)

`getAccessToken({ force })`:

1. メモリのトークンの残りが 60 秒より長く、`force` でなければそれを返す
2. 錠を取り、保存を読む。なければ「`login` をしてください」の誤り
3. 保存のトークンの残りが 60 秒より長く、`force` でなく、かつ 1 で持っていたものと違えば、それを返す
4. `POST /token`(`grant_type=refresh_token`、`refresh_token`、`client_id`、`resource`、`scope`)
5. 成功: 応答を確かめ(`token_type` が `Bearer`、`access_token` が文字列、`expires_in` が正の数。`refresh_token` があれば替える)、保存に書いてから返す。保存に失敗したら(古いリフレッシュトークンはもう使えないので)このプロセスはメモリのトークンで続け、次の起動では `login` が要ると知らせる(実装で足した)
6. `invalid_grant`: 保存を消し、「サインインが切れました。`node mcp/launcher.mjs login`」の誤り。ほかの OAuth の誤り・通信の失敗: 保存は消さず、誤りの種類だけを返す
7. 錠を外す(失敗しても)

トークンの応答の本文・トークンそのものは、どの誤りの文にも入れない(REQ-P11)。

## 6. ログアウト(REQ-P06)

保存を読み、あれば `POST /token/revocation`(`token`、`token_type_hint=refresh_token`、`client_id`)。結果によらず保存と錠を消す。

## 7. MCP サーバー(REQ-P12・P16・P20〜P23)

- `launcher.mjs` は `globalThis.__edcAuth = { getAccessToken }` を置いてから `dist/index.mjs` を読む
- `server.ts` の `EdcClient` は `baseUrl: API_BASE` 固定、`credential: () => getAccessToken()`、`fetch` は `redirect: "error"` を付けて呼ぶ
- ツールの引数から `baseUrl`・`serviceAccountKey` を消す
- `apiCall.ts` の `callWithRetry(op)`:

| 誤り | 動き |
|---|---|
| `unauthenticated`(401) | `getAccessToken({ force: true })` で取り直し、一度だけやり直す。また 401 なら「`node mcp/launcher.mjs login` をやり直してください」 |
| `internal` かつ `retryable`(500) | 2 秒待って一度だけやり直す。また失敗したら「時間をおいて試してください」 |
| `permission_denied`(403) | やり直さない。サーバーの文 + 「許可が足りません。`login` をやり直して許可してください」 |
| `budget_exhausted`(429) | やり直さない。サーバーの文 + `retryAt` |
| `rate_limited` | やり直さない。サーバーの文 + 「少し待てば使えます」 |
| ログインしていない | 「`node mcp/launcher.mjs login` を実行してください(未登録ならその中で登録できます)」 |

- 分析の作成は、やり直しでも同じ `idempotencyKey` を渡す(二重に数えない)

## 8. コマンド

| コマンド | 動き |
|---|---|
| `login [--device]` | 3 節。最後に `check` |
| `logout` | 6 節 |
| `check` | トークンを取り、`GET /v1/analyses/00000000-0000-4000-8000-000000000000`。`404 not_found` なら OK(回数を使わない)。401・403 は 7 節の文 |
| `status` | `{ authMode: "edc-account" \| "none", signedIn, store, scope, accessTokenExpiresAt, issuer, apiBase }`(秘密なし) |
| (引数なし) | MCP サーバー |

`register`・`setup` は消す。呼ばれたら「EDC アカウントに移りました。`login` を使ってください」と出して 1 で終える。

## 9. 配布物・インストーラ・説明(REQ-P30〜P33)

- 版: `plugin.json`・`mcp/package.json` を 2.0.0
- `scripts/package.mjs`: `defaults.json` とシークレットの差し込み・`--allow-missing-secret` をやめ、`edc-auth.mjs`・`token-store.mjs` を入れる。`.env.example` を外す
- `release.yml`: `EDC_OAUTH_CLIENT_SECRET` を外す(リポジトリのシークレットは、配備の後にユーザーが消す)
- `install.sh`・`install.ps1`: 「利用登録 → Enter → login」を「`login`(未登録ならその中で登録)」にする。確かめは `status` の `"signedIn": false`。確かめのファイルの一覧から `defaults.json` を外し、`edc-auth.mjs`・`token-store.mjs` を足す。`.env` の引き継ぎはやめる
- `ci.yml`: `npm test` を足し、3 つの OS で保存先の往復(実物の鍵束)を確かめる
- `README.md`・`SETUP.md`・`skills/edc-analysis/SKILL.md`・`rules/AGENTS.md`・`plugin/README.md`: `/register`・Google ログイン・API キー・サービスアカウントの記述を、EDC アカウントのログインに置き換える

## 10. テスト(REQ-P34)

| ID | 確かめること |
|---|---|
| TEST-P01 | ブラウザのログイン: 偽の認可サーバーで、認可の URL の引数(`resource`・`scope`・S256・`state`)、コールバック、コードの引き換えの引数、保存 |
| TEST-P02 | コールバックの `state` 違い・`iss` 違い・`iss` なし・`error` で失敗し、保存しない。`/callback` 以外は無視 |
| TEST-P03 | 端末のフロー: `authorization_pending` → `slow_down`(間隔が延びる)→ 成功。`expired_token`・`access_denied` で失敗 |
| TEST-P04 | 取り直し: メモリ → 保存 → 更新の順。更新でリフレッシュトークンが替わり、保存される。保存に失敗しても続け、知らせる |
| TEST-P05 | 2 つの `createAuth`(別のプロセスの代わり)が同時に取り直しても、更新は 1 回だけ(偽のサーバーは使い回しの検知で許可ごと失効させる) |
| TEST-P06 | `invalid_grant` で保存を消す。通信の失敗では消さない |
| TEST-P07 | どの誤りの文・ログにも、トークン・リフレッシュトークン・コード・検証子が入らない |
| TEST-P08 | ログアウト: 失効の呼び出しと、保存の削除 |
| TEST-P09 | 保存先: ファイルは 600・フォルダ 700。子プロセスの引数に値が入らない(macOS・Linux・Windows の組み立てを確かめる)。実物の鍵束の往復は CI の各 OS で |
| TEST-P10 | 錠: 古い錠を消す。待ち切れなければ誤り |
| TEST-P11 | `callWithRetry`: 401 で取り直して 1 回、500 internal で 1 回(同じ冪等キー)、403・429・`rate_limited` はやり直さない。文の中身 |
| TEST-P12 | MCP サーバーが起動して 4 つのツールを出し、ツールの引数に `baseUrl`・`serviceAccountKey` がない |
| TEST-P13 | 古い Google ログインの片づけ: `auth.json` があれば失効の呼び出しと削除 |

本番の確かめ(リリースの後、ユーザーの手元): `login` → `check` → 分析・読み出し・取り下げ(EDCWebAPI の REQ-R73、EDCAccount の TEST-707)。トークンの値は会話・ログに残さない。
