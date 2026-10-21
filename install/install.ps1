# EDC プラグイン(entertainment-design-catalog)のインストーラ(Windows PowerShell)
#   irm https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.ps1 | iex
# 入れる場所:
#   %USERPROFILE%\.gemini\config\plugins\entertainment-design-catalog(Antigravity の IDE / 2.0 / CLI で共通)
#   agy(Antigravity CLI)があれば、展開した一時フォルダから agy plugin install で入れ、CLI にも登録する。
#   agy plugin install は上の場所へ複写するので、入れた先のフォルダを渡してはいけない(自分自身への複写で中身が空になる)
# 環境変数: EDC_PLUGIN_VERSION=v2.0.0(既定は最新)、EDC_PLUGIN_BASE_URL(ダウンロード元。確かめ用)、EDC_PLUGIN_DIR(入れる場所)、EDC_NO_CLI=1、EDC_NO_LOGIN=1
$ErrorActionPreference = "Stop"

$Repo = "Shinh0707/edc-agent-plugin"
$Name = "entertainment-design-catalog"
$DefaultDest = Join-Path $HOME ".gemini\config\plugins\$Name"
$Dest = if ($env:EDC_PLUGIN_DIR) { $env:EDC_PLUGIN_DIR } else { $DefaultDest }
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

  # ログイン情報は OS の鍵束(または ~/.config/edc/)にあり、プラグインのフォルダには置かない
  $stage = "$tmp\x\$Name"
  New-Item -ItemType Directory -Force (Split-Path $Dest) | Out-Null
  if (Test-Path $Dest) { Copy-Item -Recurse $Dest "$tmp\old" }

  # 中身が空のファイルがあれば失敗とみなし、前の版に戻す
  function Test-Installed {
    foreach ($f in @("plugin.json", "mcp_config.json", "mcp\launcher.mjs", "mcp\edc-auth.mjs", "mcp\token-store.mjs", "mcp\dist\index.mjs", "skills\edc-analysis\SKILL.md")) {
      $p = Join-Path $Dest $f
      if (-not (Test-Path $p) -or (Get-Item $p).Length -eq 0) { return $false }
    }
    return $true
  }
  function Copy-Stage {
    if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
    Copy-Item -Recurse $stage $Dest
    if (-not (Test-Installed)) {
      Remove-Item -Recurse -Force $Dest
      if (Test-Path "$tmp\old") { Move-Item "$tmp\old" $Dest; Say "前の版に戻しました" }
      throw "入れたファイルが壊れています"
    }
  }

  if (-not $env:EDC_NO_CLI -and $Dest -eq $DefaultDest -and (Get-Command agy -ErrorAction SilentlyContinue)) {
    # agy は stage を Dest へ複写し、CLI にも登録する(Dest を渡さない)
    agy plugin install "$stage" *> "$tmp\agy.log"
    if ($LASTEXITCODE -eq 0 -and (Test-Installed)) { Say "v$pluginVersion を入れました: $Dest(Antigravity CLI にも登録)" }
    else {
      Say "agy plugin install がうまくいかなかったので、直接置きます"
      Copy-Stage
      Say "v$pluginVersion を入れました: $Dest"
    }
  } else {
    Copy-Stage
    Say "v$pluginVersion を入れました: $Dest"
  }

  if (-not $env:EDC_NO_LOGIN) {
    $answer = Read-Host "[edc] 続けて EDC アカウントにログインしますか(未登録なら、その画面で登録できます)? [Y/n]"
    if ($answer -notmatch '^(n|no)$') {
      Push-Location $Dest
      try {
        if ((node mcp/launcher.mjs status | Out-String) -match '"signedIn": false') {
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
Write-Host "  1. (まだなら)EDC アカウントにログイン(未登録なら、その画面で登録): cd `"$Dest`"; node mcp/launcher.mjs login"
Write-Host "  2. Antigravity を再起動する(または MCP サーバーを読み込み直す)"
