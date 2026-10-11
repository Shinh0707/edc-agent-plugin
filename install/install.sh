#!/bin/sh
# EDC プラグイン(entertainment-design-catalog)のインストーラ(macOS / Linux)
#   curl -fsSL https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.sh | sh
# 入れる場所:
#   Antigravity(IDE / 2.0)  ~/.gemini/config/plugins/entertainment-design-catalog   (常に)
#   Antigravity CLI         agy plugin install で ~/.gemini/antigravity-cli/plugins/  (agy があるとき)
# オプション(sh -s -- <オプション>): --dir <パス> 入れる場所を変える / --no-cli CLI には入れない / --no-login ログインを聞かない
#   環境変数 EDC_PLUGIN_VERSION=v1.2.0 で版を指定(既定は最新)。EDC_PLUGIN_BASE_URL でダウンロード元を変える(確かめ用)
set -eu

REPO="Shinh0707/edc-agent-plugin"
NAME="entertainment-design-catalog"
DEST="${HOME}/.gemini/config/plugins/${NAME}"
CLI=auto
LOGIN=ask
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DEST="$2"; shift 2 ;;
    --no-cli) CLI=no; shift ;;
    --no-login) LOGIN=no; shift ;;
    *) echo "不明なオプション: $1" >&2; exit 2 ;;
  esac
done

say() { printf '[edc] %s\n' "$*"; }
die() { printf '[edc] %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js 20 以上が必要です(https://nodejs.org/)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20 以上が必要です(今は $(node -v))"
command -v unzip >/dev/null 2>&1 || die "unzip が必要です"

if [ -n "${EDC_PLUGIN_BASE_URL:-}" ]; then BASE="$EDC_PLUGIN_BASE_URL"
elif [ "${EDC_PLUGIN_VERSION:-latest}" = latest ]; then BASE="https://github.com/${REPO}/releases/latest/download"
else BASE="https://github.com/${REPO}/releases/download/${EDC_PLUGIN_VERSION}"; fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
say "ダウンロード: ${BASE}/${NAME}.zip"
curl -fsSL -o "$TMP/${NAME}.zip" "${BASE}/${NAME}.zip" || die "ダウンロードできませんでした"
curl -fsSL -o "$TMP/${NAME}.zip.sha256" "${BASE}/${NAME}.zip.sha256" || die "チェックサムをダウンロードできませんでした"
EXPECTED=$(cut -d' ' -f1 "$TMP/${NAME}.zip.sha256")
if command -v shasum >/dev/null 2>&1; then ACTUAL=$(shasum -a 256 "$TMP/${NAME}.zip" | cut -d' ' -f1)
else ACTUAL=$(sha256sum "$TMP/${NAME}.zip" | cut -d' ' -f1); fi
[ "$EXPECTED" = "$ACTUAL" ] || die "チェックサムが合いません(ダウンロードが壊れている可能性)"

unzip -q "$TMP/${NAME}.zip" -d "$TMP/x"
[ -f "$TMP/x/${NAME}/plugin.json" ] || die "zip の中身が想定と違います"
VERSION=$(node -p "require('$TMP/x/${NAME}/plugin.json').version")

# 利用者が置いた .env は引き継ぐ(ログイン情報は ~/.config/edc/ にあり、プラグインのフォルダには置かない)
if [ -f "$DEST/.env" ]; then cp -p "$DEST/.env" "$TMP/x/${NAME}/.env"; fi
mkdir -p "$(dirname "$DEST")"
if [ -e "$DEST" ]; then mv "$DEST" "$TMP/old"; fi
mv "$TMP/x/${NAME}" "$DEST"
say "v${VERSION} を入れました: $DEST"

if [ "$CLI" != no ] && command -v agy >/dev/null 2>&1; then
  if agy plugin install "$DEST" >/dev/null 2>&1; then say "Antigravity CLI にも入れました(agy plugin install)"
  else say "Antigravity CLI への登録に失敗しました。あとで: agy plugin install \"$DEST\""; fi
fi

if [ "$LOGIN" = ask ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
  printf '[edc] 続けて利用登録とログインをしますか? [Y/n] ' >/dev/tty
  read -r ANSWER </dev/tty || ANSWER=n
  case "$ANSWER" in
    n|N|no) ;;
    *)
      if (cd "$DEST" && node mcp/launcher.mjs status | grep -q '"authMode": "none"'); then
        (cd "$DEST" && node mcp/launcher.mjs register) || true
        printf '[edc] ブラウザで「Google でログイン」を押し、「登録しました」と出たら Enter: ' >/dev/tty
        read -r _ </dev/tty || true
        (cd "$DEST" && node mcp/launcher.mjs login </dev/tty) || say "ログインできませんでした。あとで: cd \"$DEST\" && node mcp/launcher.mjs login"
      else
        (cd "$DEST" && node mcp/launcher.mjs check) || true
      fi
      ;;
  esac
fi

cat <<EOF
[edc] 次に:
  1. (まだなら)利用登録: https://entertainment-design-catalog.web.app/register
  2. (まだなら)ログイン: cd "$DEST" && node mcp/launcher.mjs login
  3. Antigravity を再起動する(または MCP サーバーを読み込み直す)
EOF
