<#
  orphan-check.ps1 -- measure the last line of every .reframe__text.

  A ragged CJK paragraph can end with two characters alone on a line, which
  reads as a mistake rather than a line break. Nothing in the contrast audit
  looks at line geometry, so this measures it directly: Range.getClientRects()
  gives one rect per line box, so the last rect's width against the widest
  rect is the actual fill ratio of the final line.

  Reports every .reframe__text on the four pages that carry the block, at the
  three widths the rest of the QA uses. Flags a fill ratio under 0.25.
#>
param(
  [int]$Port = 8791
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path $PSScriptRoot -Parent
$pages = 'work/quchong.html', 'work/chashi.html', 'work/linxi.html', 'work/lionup.html'
$widths = 1440, 1024, 390

$serve = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
  '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repoRoot 'tools\serve.ps1'), '-Port', $Port
)

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome not found' }

$profile = Join-Path $env:TEMP "cv-orphan-$(Get-Random)"
$cdpPort = 9700 + (Get-Random -Maximum 200)
$proc = $null

try {
  Start-Sleep -Seconds 2
  $proc = Start-Process $chrome -PassThru -ArgumentList @(
    '--headless=new', "--remote-debugging-port=$cdpPort", "--user-data-dir=$profile",
    '--window-size=1440,900', '--hide-scrollbars', '--no-first-run',
    '--disable-extensions', '--force-device-scale-factor=1', 'about:blank'
  )

  $ws = $null
  foreach ($i in 1..60) {
    Start-Sleep -Milliseconds 300
    try {
      $tabs = Invoke-RestMethod "http://127.0.0.1:$cdpPort/json/list" -TimeoutSec 3
      $t = $tabs | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
      if ($t.webSocketDebuggerUrl) { $ws = $t.webSocketDebuggerUrl; break }
    } catch {}
  }
  if (-not $ws) { throw 'no CDP endpoint' }

  $sock = [System.Net.WebSockets.ClientWebSocket]::new()
  $sock.ConnectAsync([Uri]$ws, [Threading.CancellationToken]::None).Wait(10000) | Out-Null
  $msgId = 0

  function Send-Cdp {
    param([string]$Method, [hashtable]$Params = @{}, [int]$TimeoutSec = 40)
    $script:msgId++
    $mine = $script:msgId
    $json = (@{ id = $mine; method = $Method; params = $Params } | ConvertTo-Json -Depth 20 -Compress)
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $sock.SendAsync([ArraySegment[byte]]::new($bytes),
      [Net.WebSockets.WebSocketMessageType]::Text, $true,
      [Threading.CancellationToken]::None).Wait(10000) | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
    while ([DateTime]::UtcNow -lt $deadline) {
      $buf = [byte[]]::new(1048576)
      $sb = [Text.StringBuilder]::new()
      do {
        $r = $sock.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None)
        if (-not $r.Wait(20000)) { throw "CDP timeout on $Method" }
        [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Result.Count))
      } while (-not $r.Result.EndOfMessage)
      $obj = $sb.ToString() | ConvertFrom-Json
      if ($obj.id -eq $mine) {
        if ($obj.error) { throw "$Method -> $($obj.error.message)" }
        return $obj.result
      }
    }
    throw "no reply to $Method"
  }

  function Eval {
    param([string]$Expr)
    $r = Send-Cdp 'Runtime.evaluate' @{ expression = $Expr; returnByValue = $true; awaitPromise = $true }
    if ($r.exceptionDetails) { throw "JS: $($r.exceptionDetails.text)" }
    return $r.result.value
  }

  Send-Cdp 'Page.enable' | Out-Null
  Send-Cdp 'Runtime.enable' | Out-Null
  Send-Cdp 'Network.setCacheDisabled' @{ cacheDisabled = $true } | Out-Null

  $probe = @'
(() => {
  const out = [];
  document.querySelectorAll('.reframe__text').forEach((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1);
    if (!rects.length) return;
    const widest = Math.max(...rects.map((r) => r.width));
    const last = rects[rects.length - 1].width;
    out.push({
      kind: el.closest('.reframe__row--found') ? 'found' : 'assumed',
      lines: rects.length,
      fill: Number((last / widest).toFixed(2)),
      chars: el.textContent.trim().length
    });
  });
  return JSON.stringify(out);
})()
'@

  $rows = @()
  foreach ($w in $widths) {
    Send-Cdp 'Emulation.setDeviceMetricsOverride' @{
      width = $w; height = 900; deviceScaleFactor = 1; mobile = ($w -lt 700)
    } | Out-Null
    foreach ($p in $pages) {
      # localhost, not 127.0.0.1: serve.ps1 registers only the localhost prefix
      # and HttpListener matches prefixes on the Host header, so the numeric
      # form 404s and the probe then finds nothing to measure.
      Send-Cdp 'Page.navigate' @{ url = "http://localhost:$Port/$p`?oc=$(Get-Random)" } | Out-Null
      foreach ($i in 1..80) {
        Start-Sleep -Milliseconds 200
        if ((Eval 'document.readyState') -eq 'complete') { break }
      }
      Start-Sleep -Milliseconds 350
      $m = Eval $probe | ConvertFrom-Json
      foreach ($r in @($m)) {
        $rows += [pscustomobject]@{
          Width = $w
          Page = ($p -replace '^work/|\.html$', '')
          Kind = $r.kind
          Chars = $r.chars
          Lines = $r.lines
          Fill = $r.fill
          Bad = ($r.fill -lt 0.25 -and $r.lines -gt 1)
        }
      }
    }
  }

  Write-Output '=== last-line fill ratio (lower = shorter tail) ==='
  foreach ($w in $widths) {
    Write-Output "  ${w}px"
    foreach ($r in ($rows | Where-Object Width -eq $w)) {
      Write-Output ("    {0,-9} {1,-8} {2,2} chars  {3} lines  fill {4}{5}" -f `
        $r.Page, $r.Kind, $r.Chars, $r.Lines, $r.Fill, $(if ($r.Bad) { '  <-- ORPHAN' } else { '' }))
    }
  }
  $bad = @($rows | Where-Object Bad)
  Write-Output ''
  Write-Output "  orphans: $($bad.Count) / $($rows.Count) measured"
  # A clean result and a result from measuring nothing print the same "0", which
  # is how the first run of this script passed while every navigation was 404ing.
  $want = $pages.Count * $widths.Count * 2
  if ($rows.Count -lt $want) {
    Write-Output "  FAILED: expected $want samples, got $($rows.Count) -- page or selector did not load"
    exit 2
  }
  if ($bad.Count) { exit 1 }
} finally {
  if ($proc -and -not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(5000) }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
  if ($serve -and -not $serve.HasExited) { $serve.Kill(); $serve.WaitForExit(3000) }
}
