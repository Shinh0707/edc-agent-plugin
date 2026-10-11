# EDC プラグイン(entertainment-design-catalog)のインストーラ(Windows PowerShell)
#   irm https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.ps1 | iex
# 入れる場所:
#   Antigravity(IDE / 2.0)  %USERPROFILE%\.gemini\config\plugins\entertainment-design-catalog   (常に)
#   Antigravity CLI         agy plugin install で %USERPROFILE%\.gemini\antigravity-cli\plugins\  (agy があるとき)
# 環境変数: EDC_PLUGIN_VERSION=v1.2.0(既定は最新)、EDC_PLUGIN_BASE_URL(ダウンロード元。確かめ用)、EDC_PLUGIN_DIR(入れる場所)、EDC_NO_CLI=1、EDC_NO_LOGIN=1
$ErrorActionPreference = "Stop"

$Repo = "Shinh0707/edc-agent-plugin"
$Name = "entertainment-design-catalog"
$Dest = if ($env:EDC_PLUGIN_DIR) { $env:EDC_PLUGIN_DIR } else { Join-Path $HOME ".gemini\config\plugins\$Name" }
function Say($m) { Write-Host "[edc] $m" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20 以上が必要です(https://nodejs.org/)" }
$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) { throw "Node.js 20 以上が必要です(今は $(node -v))" }

$version = if ($env:EDC_PLUGIN_VERSION) { $env:EDC_PLUGIN_VERSION } else { "latest" }
$base = if ($env:EDC_PLUGIN_BASE_URL) { $env:EDC_PLUGIN_BASE_URL } elseif ($version -eq "latest") { "https://github.com/$Repo/releases/latest/download" } else { "https://github.com/$Repo/releases/download/$version" }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("edc-" + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  Say "ダウンロード: $base/$Name.zip"
  Invoke-WebRequest -UseBasicParsing "$base/$Name.zip" -OutFile "$tmp\$Name.zip"
  Invoke-WebRequest -UseBasicParsing "$base/$Name.zip.sha256" -OutFile "$tmp\$Name.zip.sha256"
  $expected = ((Get-Content "$tmp\$Name.zip.sha256" -Raw).Trim() -split '\s+')[0].ToLower()
  $actual = (Get-FileHash "$tmp\$Name.zip" -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw "チェックサムが合いません(ダウンロードが壊れている可能性)" }

  Expand-Archive "$tmp\$Name.zip" -DestinationPath "$tmp\x"
  if (-not (Test-Path "$tmp\x\$Name\plugin.json")) { throw "zip の中身が想定と違います" }
  $pluginVersion = (Get-Content "$tmp\x\$Name\plugin.json" -Raw | ConvertFrom-Json).version

  # 利用者が置いた .env は引き継ぐ
  if (Test-Path "$Dest\.env") { Copy-Item "$Dest\.env" "$tmp\x\$Name\.env" }
  New-Item -ItemType Directory -Force (Split-Path $Dest) | Out-Null
  if (Test-Path $Dest) { Move-Item $Dest "$tmp\old" }
  Move-Item "$tmp\x\$Name" $Dest
  Say "v$pluginVersion を入れました: $Dest"

  if (-not $env:EDC_NO_CLI -and (Get-Command agy -ErrorAction SilentlyContinue)) {
    agy plugin install "$Dest" *> $null
    if ($LASTEXITCODE -eq 0) { Say "Antigravity CLI にも入れました(agy plugin install)" }
    else { Say "Antigravity CLI への登録に失敗しました。あとで: agy plugin install `"$Dest`"" }
  }

  if (-not $env:EDC_NO_LOGIN) {
    $answer = Read-Host "[edc] 続けて利用登録とログインをしますか? [Y/n]"
    if ($answer -notmatch '^(n|no)$') {
      Push-Location $Dest
      try {
        if ((node mcp/launcher.mjs status | Out-String) -match '"authMode": "none"') {
          node mcp/launcher.mjs register
          Read-Host "[edc] ブラウザで「Google でログイン」を押し、「登録しました」と出たら Enter" | Out-Null
          node mcp/launcher.mjs login
        } else {
          node mcp/launcher.mjs check
        }
      } finally { Pop-Location }
    }
  }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Say "次に:"
Write-Host "  1. (まだなら)利用登録: https://entertainment-design-catalog.web.app/register"
Write-Host "  2. (まだなら)ログイン: cd `"$Dest`"; node mcp/launcher.mjs login"
Write-Host "  3. Antigravity を再起動する(または MCP サーバーを読み込み直す)"
