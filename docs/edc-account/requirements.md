# 要求: プラグインの資格情報を EDC アカウントのトークンにする

- 工程: 1. 要求。状態: **承認済み(ユーザー、2026-10-21)**
- 相手: EDC アカウント(EDCAccount、issuer `https://edc-account-366057354766.asia-east1.run.app`、`docs/03-conceptual/token-contract.md`・`docs/04-detailed/api.md`)、EDC Web API(EDCWebAPI、Appbird/EDC-API PR #24、API 1.3.0)
- 背景: EDC Web API は 1.3.0 で、利用者の Google ID トークンと自分での登録(`/register`・`/v1/registrations`)をやめ、EDC アカウントのアクセストークン(`aud` = `https://entertainment-design-catalog.web.app/v1`)を受け付ける。プラグインの利用者はユーザー本人だけで、切り替えのときに EDC アカウントに登録し直す(EDCAccount の REQ-A51、EDCWebAPI の REQ-R72)

## 1. 何をするか

| ID | 要求 |
|---|---|
| REQ-P01 | プラグインの MCP サーバー・CLI(`node mcp/launcher.mjs …`)は、EDC Web API を EDC アカウントのアクセストークン(クライアント `edc-cli`、`resource` = `https://entertainment-design-catalog.web.app/v1`、スコープ `analyses:read analyses:write cases:read`)で呼ぶ |
| REQ-P02 | ログインは、ブラウザでの認可コード + PKCE(S256)、リダイレクトはループバック `http://127.0.0.1:{任意のポート}/callback`(RFC 8252)。ブラウザのない環境のために、端末のフロー(RFC 8628)も選べる |
| REQ-P03 | アクセストークン(寿命 15 分)は、切れる前にリフレッシュトークンで自動で取り直す。利用者が 15 分ごとにログインし直すことはない |
| REQ-P04 | 未登録の人には、ログインの中で EDC アカウントの登録の画面が出る。プラグインから `/register`(EDC Web API の自分での登録)へは案内しない |
| REQ-P05 | 今の Google ログイン(`~/.config/edc/auth.json`)は使わない。新しいログインが終わったら、Google のリフレッシュトークンを失効させ、ファイルを消す |
| REQ-P06 | ログアウトで、EDC アカウントのリフレッシュトークンを失効させ(RFC 7009)、手元の保存を消す |

## 2. 安全

| ID | 要求 |
|---|---|
| REQ-P10 | リフレッシュトークンとアクセストークンは、OS の鍵束(macOS のキーチェーン、Linux の Secret Service、Windows は利用者に結びつく DPAPI)に置く。鍵束がないときだけ、権限 600 のファイル(フォルダ 700)に置き、そのことを `status` で示す |
| REQ-P11 | トークン・リフレッシュトークン・認可コード・PKCE の検証子を、ログ・画面・エラーの文・MCP のツールの結果に出さない。プロセスの引数(他のプロセスから見える)にも入れない |
| REQ-P12 | トークンは EDC Web API の決まった宛先(`https://entertainment-design-catalog.web.app`)にだけ送る。宛先・発行元をツールの引数で変えられない。リダイレクトは追わない |
| REQ-P13 | ログインのコールバックは、`state` と `iss`(RFC 9207)を照合し、127.0.0.1 だけで待ち、1 回で閉じ、時間で切る |
| REQ-P14 | リフレッシュトークンは使うたびに替わり、古いものを使うと EDC アカウントは許可ごと失効させる(oidc-provider の使い回しの検知)。同時に動く複数のプロセス(IDE・CLI)が同じリフレッシュトークンを二重に使わない |
| REQ-P15 | 信頼の起点(issuer・各エンドポイント・クライアント ID・`resource`)はコードの定数に置き、`.env` などの設定で変えられない(偽の発行元にログインさせない) |
| REQ-P16 | MCP のツールの引数で、資格情報(サービスアカウントの鍵のパス・JSON)や宛先を受け取らない(プロンプトの注入で、ファイルを読ませる・トークンを外へ送らせることを防ぐ) |

## 3. エラーの扱い

| ID | 要求 |
|---|---|
| REQ-P20 | `401 unauthenticated`: 一度だけトークンを取り直してやり直す。それでも 401 なら「`node mcp/launcher.mjs login` をやり直す」と伝える |
| REQ-P21 | `403 permission_denied`(スコープ不足など): サーバーの文をそのまま出し、ログインし直して許可することを伝える。自動でやり直さない |
| REQ-P22 | `429 budget_exhausted`: サーバーの文と `retryAt` を出す。自動でやり直さない。`rate_limited` はやり直せると伝える |
| REQ-P23 | `500 internal`(`retryable`、EDC Web API が EDC アカウントの鍵を取れない): 少し待って一度だけやり直す(分析の作成は同じ冪等キーで)。それでも失敗したら、時間をおいて試すよう伝える |
| REQ-P24 | リフレッシュが `invalid_grant`(失効・期限切れ・退会・停止)なら、保存を消して `login` を案内する。通信の失敗では保存を消さない |

## 4. 移行と配布

| ID | 要求 |
|---|---|
| REQ-P30 | 版は 2.0.0(呼び方が変わる)。リリース(タグの push)は、EDC Web API の本番の切り替え(PR #24 の配備)と同時に、ユーザーの確認の後に出す |
| REQ-P31 | インストーラ(`install.sh`・`install.ps1`)は、`/register` の案内をやめ、EDC アカウントへのログイン(登録はその中)を案内する |
| REQ-P32 | Google の OAuth クライアント(ID・シークレット)は配布物とリポジトリの設定から外す(`defaults.json`、`package.mjs`、`release.yml` のシークレット) |
| REQ-P33 | 説明(`README.md`・`SETUP.md`・スキル・ルール)を新しい流れに合わせる |
| REQ-P34 | 自動のテストで、ログイン・更新・保存・同時の更新・エラーの扱いを確かめる。CI で動かす |

## 5. 決めたこと(ユーザー、2026-10-21。どれも案のとおり)

| ID | 問い | 決定 |
|---|---|---|
| Q-1 | API キー(`EDC_API_KEY`)・サービスアカウントの道を残すか | **やめて、EDC アカウントだけにする**(使うのはユーザー本人だけ。依存の `google-auth-library` も外せる。研究用の API キーは EDC Web API 側には残る) |
| Q-2 | スコープ | **約束どおり 3 つ**(`cases:read` は今のプラグインのツールでは使わないが、事例の検索のツールを足すときにログインし直さずに済む) |
| Q-3 | 鍵束がないとき | **権限 600 のファイルに置き、`status` と起動のログで知らせる**(Linux のサーバーなど) |
