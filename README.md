# EDC Agent Plugin

[Entertainment Design Catalog(EDC)](https://entertainment-design-catalog.web.app) の Web API を、AI エージェント(Antigravity など)から使うためのプラグイン `entertainment-design-catalog`(MCP サーバー + `edc-analysis` スキル + `edc-specialist` エージェント)。

## インストール

macOS / Linux:

```
curl -fsSL https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.sh | sh
```

Windows(PowerShell):

```
irm https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.ps1 | iex
```

必要なもの: Node.js 20 以上、EDC アカウント(未登録なら、ログインの画面で登録できる)。インストーラは最新のリリースをチェックサムで確かめて入れ、続けて EDC アカウントへのログインを案内する。更新も同じコマンド。

| エージェント | 入れる場所 |
| :-- | :-- |
| Antigravity(IDE / 2.0 / CLI、すべてのワークスペース) | `~/.gemini/config/plugins/entertainment-design-catalog/` |
| Antigravity(1つのワークスペースだけ) | `<ワークスペース>/.agents/plugins/entertainment-design-catalog/` |
| Antigravity CLI（`agy`） | 同じ `~/.gemini/config/plugins/entertainment-design-catalog/`。インストーラは `agy` があれば `agy plugin install` で CLI にも登録する。手で登録するときは、**入れた先ではなく展開した一時フォルダ**を渡す（`agy plugin install` はこの場所へ複写するので、入れた先を渡すと自分自身への複写で中身が空になる。agy 1.1.5 で確認） |

オプション(macOS / Linux): `curl … | sh -s -- --dir <パス> --no-cli --no-login`、版の指定は `EDC_PLUGIN_VERSION=v2.0.0`。
手で入れる手順・コマンド・困ったときは [plugin/SETUP.md](plugin/SETUP.md)。

## リポジトリの構成

| パス | 内容 |
| :-- | :-- |
| `plugin/` | プラグインの本体(配布する zip の中身)。`mcp/src/server.ts` を esbuild で `mcp/dist/index.mjs` にまとめる(dist はコミットしない)。EDC アカウントのログインとトークンは `mcp/edc-auth.mjs`・`mcp/token-store.mjs` |
| `plugin/mcp/test/` | `npm test`(`node --test`)。偽の認可サーバーでログイン・更新・保存・エラーの扱いを確かめる |
| `docs/edc-account/` | EDC アカウントへの切り替えの要求と設計 |
| `install/` | インストーラ(`install.sh`、`install.ps1`)。リリースに添付する |
| `scripts/package.mjs` | 配布用の zip を作る(入れるファイルは許可したものだけ。秘密は入れない) |
| `.github/workflows/` | `ci.yml`(ビルド・テスト・各 OS の鍵束・インストーラ・zip の確認)、`release.yml`(タグで zip を作り、Releases に出す) |

## リリースの手順

1. `plugin/plugin.json` と `plugin/mcp/package.json` の `version` を上げる(2つは同じにする)
2. main に入れてから、タグを打つ: `git tag v2.0.0 && git push origin v2.0.0`
3. `release` ワークフローが zip・チェックサム・インストーラを Releases に出す。タグと版が違えば失敗する

リポジトリの設定: シークレットはいらない(EDC アカウントの `edc-cli` は公開クライアント。issuer・宛先は `plugin/mcp/edc-auth.mjs` の定数)。2.0.0 より前に使っていた `EDC_OAUTH_CLIENT_SECRET` は消してよい。

手元で試す:

```
cd plugin/mcp && npm ci && npm test && cd ../..   # ビルドとテスト
node scripts/package.mjs                          # dist/ に zip
```

## ライセンス

MIT
