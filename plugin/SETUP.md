# セットアップ手順

**EDC アカウントに 1 回ログインする**だけで `edc-analysis` スキルが使えます。未登録なら、そのログインの画面で登録できます。

## 利用者向け

必要なもの: Node.js 20 以上（`node -v`）

### インストーラで入れる（おすすめ）

macOS / Linux:
```
curl -fsSL https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.sh | sh
```
Windows（PowerShell）:
```
irm https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.ps1 | iex
```
最新版を下の「入れる場所」に入れ、続けて EDC アカウントへのログインまで案内します。更新も同じコマンド（ログインは引き継ぐ）。終わったらエージェントアプリを再起動します。

### 入れる場所

| エージェント | 場所 |
| :-- | :-- |
| Antigravity（IDE / 2.0 / CLI、すべてのワークスペース） | `~/.gemini/config/plugins/entertainment-design-catalog/`（Windows: `%USERPROFILE%\.gemini\config\plugins\entertainment-design-catalog\`） |
| Antigravity（1つのワークスペースだけ） | `<ワークスペース>/.agents/plugins/entertainment-design-catalog/` |
| Antigravity CLI（`agy`） | 同じ `~/.gemini/config/plugins/entertainment-design-catalog/`。インストーラは `agy` があれば `agy plugin install` で CLI にも登録する。手で登録するときは、**入れた先ではなく展開した一時フォルダ**を渡す（`agy plugin install` はこの場所へ複写するので、入れた先を渡すと自分自身への複写で中身が空になる。agy 1.1.5 で確認） |

### 手で入れる

1. [Releases](https://github.com/Shinh0707/edc-agent-plugin/releases/latest) の `entertainment-design-catalog.zip` を展開し、中の `entertainment-design-catalog/` を上の「入れる場所」に置く
2. ターミナルでこのフォルダに移動し、ログインを 1 回実行する。
   ```
   node mcp/launcher.mjs login
   ```
   ブラウザで EDC アカウントの画面が開く → Google でログイン（未登録なら、続けて登録）→ 許可の画面で「許可」→ `EDC アカウントにログインしました` と、続けて `OK: … EDC account sign-in accepted.` と出れば完了。
   ブラウザのない環境（SSH の先など）では `node mcp/launcher.mjs login --device` で、表示された URL を別の端末で開き、コードを確かめてログインする。
3. エージェントアプリを再起動（または MCP サーバーを再読み込み）。
4. 以降は「このシーンをEDCで分析して: …」のように呼ぶだけ。トークンは自動で更新されます（15 分ごと。リフレッシュトークンは 30 日使わないか、最初のログインから 90 日で切れるので、そのときは `login` をやり直す）。

ログイン情報は OS の鍵束（macOS のキーチェーン、Linux の Secret Service、Windows は DPAPI で暗号化したファイル）に保存され、プラグインのフォルダには残りません。鍵束がない環境では `~/.config/edc/token.json`（権限 600）に置き、`status` にそう出ます。
1.x の Google ログイン（`~/.config/edc/auth.json`）は、新しいログインが終わると失効させて消します。

### 状況別
| 症状 | 対処 |
| :-- | :-- |
| `サインインしていません` / `Not signed in` | `node mcp/launcher.mjs login`（未登録なら、その画面で登録） |
| `サインインが切れました` | 失効・期限切れ・アカウントの停止。`login` をやり直す |
| `401 unauthenticated` | `login` をやり直す |
| `403 permission_denied`（この操作の許可が足りません） | `login` をやり直し、許可の画面で許可する |
| `500 internal`（資格情報を確かめられませんでした） | サーバー側の一時的な失敗。時間をおいて再試行（ツールは一度だけ自動でやり直す） |
| `budget_exhausted` | 1日の利用枠の上限。`retryAt`（Asia/Tokyo の日付区切り）以降に再試行 |
| ログインの画面で「順番待ち」「停止しています」 | EDC アカウントの画面の案内に従う |
| `トークンの錠を取れませんでした` | ほかの EDC のプロセスが止まっていれば、示されたファイル（`~/.config/edc/token.lock`）を消す |
| `Cannot reach …` | ネットワーク |

### コマンド
| コマンド | 用途 |
| :-- | :-- |
| `node mcp/launcher.mjs login` | EDC アカウントにログイン（ブラウザ。未登録ならその中で登録） |
| `node mcp/launcher.mjs login --device` | 別の端末のブラウザでログイン |
| `node mcp/launcher.mjs logout` | ログインを失効させ、消す |
| `node mcp/launcher.mjs check` | 接続とログインの確認（読み取りのみ。分析の回数は消費しない） |
| `node mcp/launcher.mjs status` | ログインの状態・保存先・接続先（秘密は出さない） |

接続先（EDC アカウント `https://edc-account-366057354766.asia-east1.run.app`、EDC Web API `https://entertainment-design-catalog.web.app`）は固定で、設定では変えられません。
