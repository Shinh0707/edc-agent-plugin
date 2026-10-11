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

必要なもの: Node.js 20 以上、Google アカウント。インストーラは最新のリリースをチェックサムで確かめて入れ、続けて利用登録(https://entertainment-design-catalog.web.app/register)と Google ログインを案内する。更新も同じコマンド。

| エージェント | 入れる場所 |
| :-- | :-- |
| Antigravity(IDE / 2.0 / CLI、すべてのワークスペース) | `~/.gemini/config/plugins/entertainment-design-catalog/` |
| Antigravity(1つのワークスペースだけ) | `<ワークスペース>/.agents/plugins/entertainment-design-catalog/` |
| Antigravity CLI（`agy`） | 同じ `~/.gemini/config/plugins/entertainment-design-catalog/`。インストーラは `agy` があれば `agy plugin install` で CLI にも登録する。手で登録するときは、**入れた先ではなく展開した一時フォルダ**を渡す（`agy plugin install` はこの場所へ複写するので、入れた先を渡すと自分自身への複写で中身が空になる。agy 1.1.5 で確認） |

オプション(macOS / Linux): `curl … | sh -s -- --dir <パス> --no-cli --no-login`、版の指定は `EDC_PLUGIN_VERSION=v1.2.0`。
手で入れる手順・コマンド・困ったときは [plugin/SETUP.md](plugin/SETUP.md)。

## リポジトリの構成

| パス | 内容 |
| :-- | :-- |
| `plugin/` | プラグインの本体(配布する zip の中身)。`mcp/src/server.ts` を esbuild で `mcp/dist/index.mjs` にまとめる(dist はコミットしない) |
| `install/` | インストーラ(`install.sh`、`install.ps1`)。リリースに添付する |
| `scripts/package.mjs` | 配布用の zip を作る(入れるファイルは許可したものだけ。OAuth のシークレットは環境変数から入れる) |
| `.github/workflows/` | `ci.yml`(ビルド・起動・zip の確認)、`release.yml`(タグで zip を作り、Releases に出す) |

## リリースの手順

1. `plugin/plugin.json` と `plugin/mcp/package.json` の `version` を上げる(2つは同じにする)
2. main に入れてから、タグを打つ: `git tag v1.2.1 && git push origin v1.2.1`
3. `release` ワークフローが zip・チェックサム・インストーラを Releases に出す。タグと版が違えば失敗する

リポジトリの設定: Actions のシークレット `EDC_OAUTH_CLIENT_SECRET`(デスクトップアプリの OAuth クライアントのシークレット。Google の定義上は秘密でない値だが、リポジトリには置かない)。クライアント ID は `plugin/mcp/defaults.json` にある。

手元で試す:

```
cd plugin/mcp && npm ci && npm run build && cd ../..
node scripts/package.mjs --allow-missing-secret   # dist/ に zip
```

## ライセンス

MIT
