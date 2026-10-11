# セットアップ手順

**登録ページで Google ログイン → プラグインで Google ログイン**の 2 回だけで `edc-analysis` スキルが使えます（APIキー方式も併用可）。

## 利用者向け

必要なもの: Node.js 20 以上（`node -v`）／Google アカウント

### インストーラで入れる（おすすめ）

macOS / Linux:
```
curl -fsSL https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.sh | sh
```
Windows（PowerShell）:
```
irm https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.ps1 | iex
```
最新版を下の「入れる場所」に入れ、続けて利用登録とログインまで案内します。更新も同じコマンド（`.env` は引き継ぐ）。終わったらエージェントアプリを再起動します。

### 入れる場所

| エージェント | 場所 |
| :-- | :-- |
| Antigravity（IDE / 2.0 / CLI、すべてのワークスペース） | `~/.gemini/config/plugins/entertainment-design-catalog/`（Windows: `%USERPROFILE%\.gemini\config\plugins\entertainment-design-catalog\`） |
| Antigravity（1つのワークスペースだけ） | `<ワークスペース>/.agents/plugins/entertainment-design-catalog/` |
| Antigravity CLI（`agy`） | 同じ `~/.gemini/config/plugins/entertainment-design-catalog/`。インストーラは `agy` があれば `agy plugin install` で CLI にも登録する。手で登録するときは、**入れた先ではなく展開した一時フォルダ**を渡す（`agy plugin install` はこの場所へ複写するので、入れた先を渡すと自分自身への複写で中身が空になる。agy 1.1.5 で確認） |

### 手で入れる

0. 登録ページ **https://entertainment-design-catalog.web.app/register** を開き、「Google でログイン」を押す（`node mcp/launcher.mjs register` でも開く）。`登録しました。` と出れば完了。管理者への連絡はいらない。サーバーにはメールアドレスそのものは残らない
1. [Releases](https://github.com/Shinh0707/edc-agent-plugin/releases/latest) の `entertainment-design-catalog.zip` を展開し、中の `entertainment-design-catalog/` を上の「入れる場所」に置く
2. ターミナルでこのフォルダに移動し、ログインを 1 回実行する。
   ```
   node mcp/launcher.mjs login
   ```
   ブラウザが開くので、**0 と同じ Google アカウント**でログイン → `Signed in as …` と、続けて `OK: … Google account … accepted.` と出れば完了。
3. エージェントアプリを再起動（または MCP サーバーを再読み込み）。
4. 以降は「このシーンをEDCで分析して: …」のように呼ぶだけ。トークンは自動で更新されます。

ログイン情報は `~/.config/edc/auth.json`（権限 600）に保存され、プラグインフォルダには残りません。

### 状況別
| 症状 | 対処 |
| :-- | :-- |
| `403 permission_denied … is not registered` | そのアカウントが未登録。表示された登録ページで、同じ Google アカウントで登録してから `check` |
| 登録ページで「受け付けていません」「停止しています」 | 管理者に連絡 |
| `OAuth client ID is not configured` | 配布物の設定漏れ。配布元に連絡 |
| `401 … does not accept this Google login` | このログイン方式がサーバーで許可されていない。管理者に連絡 |
| `Google login expired or was revoked` | `node mcp/launcher.mjs login` をやり直す |
| `Cannot reach …` | ネットワーク、または `EDC_BASE_URL` が違う |
| `budget_exhausted` | 1日の利用枠の上限。`retryAt`（Asia/Tokyo の日付区切り）以降に再試行 |

### コマンド
| コマンド | 用途 |
| :-- | :-- |
| `node mcp/launcher.mjs register` | 登録ページをブラウザで開く |
| `node mcp/launcher.mjs login` / `logout` | Google ログイン／ログアウト |
| `node mcp/launcher.mjs check` | 接続と資格情報の確認（読み取りのみ。分析の回数は消費しない） |
| `node mcp/launcher.mjs status` | 認証方式・エンドポイント・ログイン中のアカウント（秘密は出さない） |
| `node mcp/launcher.mjs setup` | 代替: 管理者から受け取った API キー（`edc_sk_…`）を登録 |

優先順位: `EDC_API_KEY` > サービスアカウント（`EDC_SERVICE_ACCOUNT_KEY` / `GOOGLE_APPLICATION_CREDENTIALS`）> Google ログイン。
設定の探索順: 実環境変数 > `$EDC_ENV_FILE` > `<プラグイン>/.env` > `~/.config/edc/.env` > `mcp/defaults.json`。
