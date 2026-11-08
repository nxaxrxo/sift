$out = "C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift\public\assets\fraunces-latin.woff2"
$done = "C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift\.font.done"
try {
  Invoke-WebRequest -Uri "https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeA.woff2" -OutFile $out -UseBasicParsing -TimeoutSec 45
  "ok $((Get-Item $out).Length)" | Out-File $done -Encoding utf8
} catch {
  "fail $($_.Exception.Message)" | Out-File $done -Encoding utf8
}
