<#
  Headless screenshot helper.

  There is no image toolchain on this machine, so Chrome is the renderer for
  both QA captures and the asset pipeline.

  This drives Chrome over the DevTools protocol rather than through the one-shot
  --screenshot= flag, because that flag had three failure modes and every one of
  them was silent -- it always produced a plausible PNG:

    - --screenshot-full-page is ignored by the Chrome installed here, so
      -FullPage returned a viewport crop.
    - The success line printed the requested *window* size rather than the size
      of the image actually written, so that crop looked like a full page.
    - --virtual-time-budget captures on a timer. A large hero WebP that had not
      finished decoding was captured as its LQIP placeholder, which is a blurred
      20-pixel thumbnail -- so the capture showed the exact defect you would use
      this tool to check for, and looked like real output while doing it.

  A capture is evidence, and evidence that fails by quietly substituting
  something else is worse than no evidence. So: wait on actual decodes, not on a
  clock; ask for the full page through captureBeyondViewport, which is honoured;
  and report the dimensions read back out of the PNG header rather than the ones
  that were requested.

  Kept from the previous version: one reusable profile directory cleaned on exit
  (earlier runs left ~100 orphaned processes and 1.8 GB of Temp profiles), and
  --force-prefers-reduced-motion so captures show the settled layout rather than
  whichever frame the reveal animations were on.
#>
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1500,
  [int]$Height = 1000,
  [int]$SettleMs = 2600,
  [int]$Dpr = 1,
  [switch]$FullPage,
  [switch]$AllowMotion
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'no chromium binary found' }

$profileDir = Join-Path $env:TEMP 'zigi-shot-profile'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$outDir = Split-Path $Out -Parent
if ($outDir) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$cdpPort = 9600 + (Get-Random -Maximum 300)
$chromeArgs = @(
  '--headless=new'
  "--remote-debugging-port=$cdpPort"
  '--hide-scrollbars'
  '--no-first-run'
  '--no-default-browser-check'
  '--disable-extensions'
  '--disable-background-networking'
  '--force-device-scale-factor=1'
  "--user-data-dir=$profileDir"
  "--window-size=$Width,$Height"
)
if (-not $AllowMotion) { $chromeArgs += '--force-prefers-reduced-motion' }
$chromeArgs += 'about:blank'

$p = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -PassThru -WindowStyle Hidden
$sock = $null

try {
  $ws = $null
  foreach ($i in 1..60) {
    Start-Sleep -Milliseconds 300
    try {
      $t = (Invoke-RestMethod "http://127.0.0.1:$cdpPort/json/list" -TimeoutSec 3) |
        Where-Object { $_.type -eq 'page' } | Select-Object -First 1
      if ($t.webSocketDebuggerUrl) { $ws = $t.webSocketDebuggerUrl; break }
    } catch { }
  }
  if (-not $ws) { throw 'no CDP endpoint' }

  $sock = [System.Net.WebSockets.ClientWebSocket]::new()
  $sock.ConnectAsync([Uri]$ws, [Threading.CancellationToken]::None).Wait(10000) | Out-Null
  $script:msgId = 0

  function Send-Cdp {
    param([string]$Method, [hashtable]$Params = @{})
    $script:msgId++
    $mine = $script:msgId
    $json = @{ id = $mine; method = $Method; params = $Params } | ConvertTo-Json -Depth 20 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $sock.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text,
      $true, [Threading.CancellationToken]::None).Wait(10000) | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $deadline) {
      $buf = [byte[]]::new(8388608)
      $sb = [Text.StringBuilder]::new()
      do {
        $r = $sock.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None)
        if (-not $r.Wait(60000)) { throw "timeout $Method" }
        [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Result.Count))
      } while (-not $r.Result.EndOfMessage)
      $o = $sb.ToString() | ConvertFrom-Json
      if ($o.id -eq $mine) {
        if ($o.error) { throw "$Method -> $($o.error.message)" }
        return $o.result
      }
    }
    throw "no reply $Method"
  }

  function Eval {
    param([string]$Expression)
    $r = Send-Cdp 'Runtime.evaluate' @{
      expression = $Expression; returnByValue = $true; awaitPromise = $true
    }
    if ($r.exceptionDetails) { throw "JS: $($r.exceptionDetails.text)" }
    return $r.result.value
  }

  Send-Cdp 'Page.enable' | Out-Null
  Send-Cdp 'Runtime.enable' | Out-Null
  # A reusable QA profile must not make reusable QA output: bypass both the
  # HTTP memory/disk cache and the site's service worker so a capture always
  # reflects the files currently on disk.
  Send-Cdp 'Network.enable' | Out-Null
  Send-Cdp 'Network.setCacheDisabled' @{ cacheDisabled = $true } | Out-Null
  Send-Cdp 'Network.setBypassServiceWorker' @{ bypass = $true } | Out-Null
  Send-Cdp 'Emulation.setDeviceMetricsOverride' @{
    width = $Width; height = $Height; deviceScaleFactor = $Dpr; mobile = $false
  } | Out-Null

  Send-Cdp 'Page.navigate' @{ url = $Url } | Out-Null
  foreach ($i in 1..100) {
    Start-Sleep -Milliseconds 200
    if ((Eval 'document.readyState') -eq 'complete') { break }
  }

  <# The point of the rewrite. Every image is made eager and awaited on decode(),
     which resolves when the bitmap is ready to paint rather than when the bytes
     arrive -- a decoded image cannot still be showing its placeholder. Lazy
     images below the fold are included deliberately: -FullPage captures them,
     so they have to be real before the shutter. #>
  $decoded = Eval @'
(async () => {
  const imgs = [...document.images];
  imgs.forEach((i) => { i.loading = 'eager'; });
  const settled = await Promise.all(imgs.map(async (i) => {
    try {
      await i.decode();
      return i.naturalWidth > 0;
    } catch {
      return false;       // a broken src is the page's problem, not the shutter's
    }
  }));
  await document.fonts.ready;
  return JSON.stringify({ total: imgs.length, ok: settled.filter(Boolean).length });
})()
'@ | ConvertFrom-Json

  # Whatever is left is animation settling, not loading, so this is now a short
  # grace period rather than the thing correctness depends on.
  Start-Sleep -Milliseconds ([Math]::Min($SettleMs, 1200))

  $shot = Send-Cdp 'Page.captureScreenshot' @{
    format = 'png'
    captureBeyondViewport = [bool]$FullPage
  }
  [IO.File]::WriteAllBytes($Out, [Convert]::FromBase64String($shot.data))

  # Dimensions out of the PNG's IHDR -- bytes 16..23, big-endian -- because the
  # requested size is what the old version reported and is exactly what cannot
  # be trusted here.
  $head = [byte[]]::new(24)
  $fs = [IO.File]::OpenRead($Out)
  try { $fs.Read($head, 0, 24) | Out-Null } finally { $fs.Close() }
  $gotW = [int]$head[16] * 16777216 + [int]$head[17] * 65536 + [int]$head[18] * 256 + [int]$head[19]
  $gotH = [int]$head[20] * 16777216 + [int]$head[21] * 65536 + [int]$head[22] * 256 + [int]$head[23]

  $kb = (Get-Item $Out).Length / 1KB
  "{0}  ({1:N0} KB, {2}x{3} captured, {4}/{5} images decoded)" -f `
    $Out, $kb, $gotW, $gotH, $decoded.ok, $decoded.total

  if ($decoded.ok -lt $decoded.total) {
    Write-Warning "$($decoded.total - $decoded.ok) image(s) failed to decode -- the capture may show placeholders"
  }
  if ($FullPage -and $gotH -le $Height * $Dpr) {
    Write-Warning "-FullPage asked for the whole document but the capture is $gotH px tall"
  }
} finally {
  if ($sock) { $sock.Dispose() }
  if ($p -and -not $p.HasExited) { $p.Kill(); $p.WaitForExit(5000) | Out-Null }
  # Chrome forks renderer/gpu children that survive the parent; without this the
  # profile stays locked and the next run silently reuses a stale window size.
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
    Where-Object { $_.CommandLine -like "*$profileDir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
