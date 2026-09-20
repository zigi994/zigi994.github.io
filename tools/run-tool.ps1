<#
  run-tool.ps1 -- run any of the /__tools/ browser pages headless and print its log.

  The pipeline pages were built to be opened by hand, which is fine once and
  tedious when iterating on a trace threshold. This starts the server, loads the
  page in headless Chrome, polls its #log until the page writes DONE (or ERROR),
  and prints what it said. Everything those pages produce they POST to /_save
  themselves, so there is nothing to collect here.

    run-tool.ps1 vectorize.html "stage=svg&eps=0.6"
#>
param(
  [Parameter(Mandatory = $true)][string]$Page,
  [string]$Query = '',
  [int]$Port = 8790,
  [int]$TimeoutSec = 240,
  [switch]$KeepShot
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path $PSScriptRoot -Parent
$qaDir = Join-Path $repoRoot 'tools\_qa'
New-Item -ItemType Directory -Force -Path $qaDir | Out-Null

$serve = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repoRoot 'tools\serve.ps1'), '-Port', $Port
)

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome not found' }

$profile = Join-Path $env:TEMP "cv-run-$(Get-Random)"
$cdpPort = 9400 + (Get-Random -Maximum 90)
$proc = $null

try {
  Start-Sleep -Seconds 2
  $proc = Start-Process $chrome -PassThru -ArgumentList @(
    '--headless=new', "--remote-debugging-port=$cdpPort", "--user-data-dir=$profile",
    '--window-size=1600,1200', '--hide-scrollbars', '--no-first-run',
    '--disable-extensions', '--allow-file-access-from-files', 'about:blank'
  )
  $ws = $null
  foreach ($i in 1..60) {
    Start-Sleep -Milliseconds 300
    try {
      $t = (Invoke-RestMethod "http://127.0.0.1:$cdpPort/json/list" -TimeoutSec 3) |
        Where-Object { $_.type -eq 'page' } | Select-Object -First 1
      if ($t.webSocketDebuggerUrl) { $ws = $t.webSocketDebuggerUrl; break }
    } catch {}
  }
  if (-not $ws) { throw 'no CDP endpoint' }

  $sock = [System.Net.WebSockets.ClientWebSocket]::new()
  $sock.ConnectAsync([Uri]$ws, [Threading.CancellationToken]::None).Wait(10000) | Out-Null
  $msgId = 0
  function Send-Cdp {
    param([string]$Method, [hashtable]$Params = @{})
    $script:msgId++; $mine = $script:msgId
    $b = [Text.Encoding]::UTF8.GetBytes((@{ id = $mine; method = $Method; params = $Params } | ConvertTo-Json -Depth 20 -Compress))
    $sock.SendAsync([ArraySegment[byte]]::new($b), [Net.WebSockets.WebSocketMessageType]::Text, $true,
      [Threading.CancellationToken]::None).Wait(10000) | Out-Null
    $dl = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $dl) {
      $buf = [byte[]]::new(4194304); $sb = [Text.StringBuilder]::new()
      do {
        $r = $sock.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None)
        if (-not $r.Wait(30000)) { throw "timeout $Method" }
        [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Result.Count))
      } while (-not $r.Result.EndOfMessage)
      $o = $sb.ToString() | ConvertFrom-Json
      if ($o.id -eq $mine) { if ($o.error) { throw "$Method -> $($o.error.message)" }; return $o.result }
    }
    throw "no reply $Method"
  }
  function Eval { param([string]$E)
    $r = Send-Cdp 'Runtime.evaluate' @{ expression = $E; returnByValue = $true; awaitPromise = $true }
    if ($r.exceptionDetails) { return "__JSERR__ $($r.exceptionDetails.text) $($r.exceptionDetails.exception.description)" }
    return $r.result.value
  }

  Send-Cdp 'Page.enable' | Out-Null
  Send-Cdp 'Runtime.enable' | Out-Null
  Send-Cdp 'Network.setCacheDisabled' @{ cacheDisabled = $true } | Out-Null

  $url = "http://localhost:$Port/__tools/$Page" + $(if ($Query) { "?$Query" } else { '' })
  Write-Output "run-tool: $url"
  Send-Cdp 'Page.navigate' @{ url = $url } | Out-Null

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
  $last = ''
  while ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 700
    $txt = Eval '(document.getElementById("log") || {}).textContent || ""'
    if ($txt -like '__JSERR__*') { $last = $txt; break }
    if ($txt) { $last = $txt }
    if ($txt -match '(?m)^DONE' -or $txt -match 'DONE\s*$' -or $txt -match 'ERROR') { break }
  }

  Write-Output '--- page log ---'
  ($last -split "`n") | ForEach-Object { "  $_" }

  if ($KeepShot) {
    $s = Send-Cdp 'Page.captureScreenshot' @{ format = 'png'; captureBeyondViewport = $true }
    $p = Join-Path $qaDir (($Page -replace '\.html$', '') + '-run.png')
    [IO.File]::WriteAllBytes($p, [Convert]::FromBase64String($s.data))
    Write-Output "  shot -> tools/_qa/$(Split-Path $p -Leaf)"
  }

  if ($last -match 'ERROR' -or $last -like '__JSERR__*') { exit 1 }
} finally {
  if ($proc -and -not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(5000) }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
  if ($serve -and -not $serve.HasExited) { $serve.Kill(); $serve.WaitForExit(3000) }
}
