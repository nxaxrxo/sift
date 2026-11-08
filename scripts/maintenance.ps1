# One-off maintenance: purge non-English rows, then rebuild and publish.
#
# Same shape as refresh-local.ps1: a lock, a log, a done-file. Runs detached so
# the session is never parked inside a two-minute feed sweep.
$ErrorActionPreference = "Stop"
$root = "C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift"
Set-Location $root

# Node writes its experimental-SQLite warning to stderr. PowerShell turns any
# stderr line into a terminating error when ErrorActionPreference is Stop, which
# aborted this script on a warning. Redirect through the shell instead.
$ErrorActionPreference = "Continue"

$lock = Join-Path $root ".dev\manual.lock"
$done = Join-Path $root ".dev\manual.done"
$log  = Join-Path $root ".dev\manual.log"

if (Test-Path $lock) {
  "already running" | Out-File $done -Encoding utf8
  exit 1
}
New-Item -ItemType File -Path $lock -Force | Out-Null
Set-Content -Path $done -Value "running"

try {
  & node "scripts/purge-language.mjs" --db .dev/sift.db *> $log
  $purgeExit = $LASTEXITCODE
  Add-Content -Path $log -Value "`npurge exit=$purgeExit`n"

  & node "scripts/publish.mjs" *>> $log
  $publishExit = $LASTEXITCODE

  Set-Content -Path $done -Value "exit=$publishExit purge=$purgeExit $([DateTime]::Now.ToString('o'))"
}
catch {
  Set-Content -Path $done -Value "FAILED: $($_.Exception.Message)"
}
finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
