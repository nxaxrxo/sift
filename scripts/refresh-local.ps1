# Sift — local fallback refresh.
#
# Runs the same pipeline the GitHub workflow would: seed from the live board,
# ingest every feed, rebuild, push gh-pages. Registered as a hidden scheduled
# task so the site keeps moving until the sync workflow can be restored.
#
# Remove with:  Unregister-ScheduledTask -TaskName "SiftRefresh" -Confirm:$false

$root = "C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift"
Set-Location $root

$log = Join-Path $root ".dev\refresh.log"
$done = Join-Path $root ".dev\refresh.done"

# One run at a time. A publish takes ~3 minutes and the task fires every 30;
# without this two runs would fight over dist/ and the gh-pages worktree.
$lock = Join-Path $root ".dev\refresh.lock"
if (Test-Path $lock) {
    $age = (Get-Date) - (Get-Item $lock).LastWriteTime
    if ($age.TotalMinutes -lt 12) { exit 0 }
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType File -Path $lock -Force | Out-Null

try {
    & node "scripts/publish.mjs" *> $log
    $code = $LASTEXITCODE
} catch {
    $_ | Out-String | Add-Content $log
    $code = 1
} finally {
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}

"exit=$code $(Get-Date -Format o)" | Out-File $done -Encoding utf8

# Keep the log from growing forever; the last few runs are enough to diagnose.
if ((Get-Item $log -ErrorAction SilentlyContinue).Length -gt 400KB) {
    Get-Content $log -Tail 200 | Set-Content $log
}
