<#
  audit-drive.ps1 -- pixel transport for tools/audit.html

  WHY THIS EXISTS
    audit.html measures text contrast from the pixels actually painted behind a
    glyph, which is the only way to get a correct answer when the backdrop is a
    gradient, a photograph, a <canvas>, a blend mode or a sibling underlay. A
    page cannot screenshot itself, so the capture is done here over the Chrome
    DevTools Protocol and the sampled colours are handed back in.

    audit.html still drives itself. This script only launches Chrome, installs
    two bindings and answers pixel requests; the harness decides what to sample,
    does all the maths, and writes tools/_qa/audit-*.{json,txt} exactly as before.

  USAGE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\audit-drive.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\audit-drive.ps1 -Page work/lionup.html
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\audit-drive.ps1 -Vp mobile

    Needs the dev server up first:
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8787

    Opening http://localhost:8787/__tools/audit.html in a browser still works and
    still runs every other check, but with no transport the contrast numbers fall
    back to the old ancestor-background estimate and are labelled as such.

  PROTOCOL
    window.__auditShot(json)   {id, rect:{x,y,w,h}, points:[[x,y],...]}  page coords
                               -> window.__auditShotResult({id, colors:[hex,...]})
    window.__auditDone(json)   run finished; this script exits
#>

param(
  [int]$Port = 8787,          # dev server
  [int]$CdpPort = 9222,       # chrome debugging port
  [string]$Page = '',         # e.g. work/lionup.html
  [string]$Vp = '',           # desktop | laptop | portrait | mobile
  [int]$TimeoutMin = 45
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# The host viewport must fit the tallest frame the harness stages (portrait is
# 768x1024) at the document origin, so every capture clip lands inside the
# viewport and captureBeyondViewport never has to be involved.
$HOST_W = 1500
$HOST_H = 1300

$repoRoot = Split-Path $PSScriptRoot -Parent
$qaDir = Join-Path $repoRoot 'tools\_qa'
$doneFile = Join-Path $qaDir 'AUDIT_DONE.txt'
if (Test-Path $doneFile) { Remove-Item $doneFile -Force }

$q = @()
if ($Page) { $q += 'page=' + $Page }
if ($Vp) { $q += 'vp=' + $Vp }
$url = "http://localhost:$Port/__tools/audit.html" + $(if ($q.Count) { '?' + ($q -join '&') } else { '' })

# --- sanity: is the dev server actually up? -----------------------------------
try {
  [void](Invoke-WebRequest -Uri "http://localhost:$Port/" -TimeoutSec 5 -UseBasicParsing)
} catch {
  Write-Output "dev server not answering on port $Port."
  Write-Output "  start it:  powershell -NoProfile -ExecutionPolicy Bypass -File tools\serve.ps1 -Port $Port"
  exit 1
}

# --- minimal CDP client -------------------------------------------------------
function Find-Chrome {
  return @(
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

$script:ws = $null
$script:seq = 0
# Events that arrived while waiting for a command reply. Binding calls land here
# whenever one is raised during a capture, so this queue has to be drained
# alongside fresh reads or a request would be answered out of order.
$script:queue = New-Object System.Collections.Queue

function Read-Frame {
  param([int]$TimeoutMs = 120000)
  $sb = New-Object System.Text.StringBuilder
  $buf = New-Object 'byte[]' 262144
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ($true) {
    $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @($buf, 0, $buf.Length)
    $task = $script:ws.ReceiveAsync($seg, [Threading.CancellationToken]::None)
    $left = [int][Math]::Max(50, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    if (-not $task.Wait($left)) { return $null }
    $res = $task.Result
    [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $res.Count))
    if ($res.EndOfMessage) { break }
  }
  return $sb.ToString()
}

function Send-Cdp {
  param([string]$Method, $Params = @{})
  $script:seq++
  $id = $script:seq
  $msg = (@{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 20 -Compress)
  $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
  $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @($bytes, 0, $bytes.Length)
  [void]$script:ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true,
    [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  return $id
}

# Returns the raw JSON of the reply. Anything else read on the way is queued.
function Invoke-CdpRaw {
  param([string]$Method, $Params = @{}, [int]$TimeoutMs = 120000)
  $id = Send-Cdp $Method $Params
  for ($n = 0; $n -lt 2000; $n++) {
    $raw = Read-Frame $TimeoutMs
    if ($null -eq $raw) { throw "CDP timeout on $Method" }
    if ($raw -match ('^\{"id"\s*:\s*' + $id + '\b')) { return $raw }
    $script:queue.Enqueue($raw)
  }
  throw "CDP: no reply to $Method"
}

function Invoke-Cdp {
  param([string]$Method, $Params = @{}, [int]$TimeoutMs = 120000)
  $obj = (Invoke-CdpRaw $Method $Params $TimeoutMs) | ConvertFrom-Json
  if ($obj.PSObject.Properties.Name -contains 'error' -and $obj.error) {
    throw "CDP error on ${Method}: $($obj.error.message)"
  }
  return $obj.result
}

# --- launch -------------------------------------------------------------------
$chrome = Find-Chrome
if (-not $chrome) { throw 'no chromium binary found' }

$profileDir = Join-Path $env:TEMP 'zigi-audit-drive-profile'
if (Test-Path $profileDir) { Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$chromeArgs = @(
  '--headless=new'
  '--disable-gpu'
  '--hide-scrollbars'
  '--no-first-run'
  '--no-default-browser-check'
  '--disable-extensions'
  '--disable-background-networking'
  '--force-device-scale-factor=1'
  "--window-size=$HOST_W,$HOST_H"
  "--user-data-dir=$profileDir"
  "--remote-debugging-port=$CdpPort"
  'about:blank'
)

Write-Output "audit-drive: launching $(Split-Path $chrome -Leaf) headless on CDP port $CdpPort"
$proc = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -PassThru -WindowStyle Hidden

$wsUrl = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 400
  try {
    $list = Invoke-RestMethod "http://127.0.0.1:$CdpPort/json/list" -TimeoutSec 3
    $t = $list | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
    if ($t -and $t.webSocketDebuggerUrl) { $wsUrl = $t.webSocketDebuggerUrl; break }
  } catch { }
}
if (-not $wsUrl) { throw "chrome never exposed a page target on port $CdpPort" }

$script:ws = New-Object System.Net.WebSockets.ClientWebSocket
$script:ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
[void]$script:ws.ConnectAsync([Uri]$wsUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()

$shots = 0
$points = 0
$swAll = [Diagnostics.Stopwatch]::StartNew()

try {
  [void](Invoke-Cdp 'Runtime.enable')
  [void](Invoke-Cdp 'Page.enable')

  # Reveal animations are gated on prefers-reduced-motion, and headless Chrome
  # reports 'reduce'. Without this the pages measure in their pre-reveal state.
  [void](Invoke-Cdp 'Emulation.setEmulatedMedia' @{
    features = @(@{ name = 'prefers-reduced-motion'; value = 'no-preference' })
  })
  [void](Invoke-Cdp 'Emulation.setDeviceMetricsOverride' @{
    width = $HOST_W; height = $HOST_H; deviceScaleFactor = 1; mobile = $false
  })

  # Before navigating, so the audit page's context has them at parse time and
  # HAS_PIXELS is true on the first line it runs.
  [void](Invoke-Cdp 'Runtime.addBinding' @{ name = '__auditShot' })
  [void](Invoke-Cdp 'Runtime.addBinding' @{ name = '__auditDone' })

  Write-Output "audit-drive: $url"
  [void](Invoke-Cdp 'Page.navigate' @{ url = $url })

  $done = $false
  $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMin)

  function Get-Next {
    if ($script:queue.Count -gt 0) { return $script:queue.Dequeue() }
    return (Read-Frame 60000)
  }

  while (-not $done) {
    if ([DateTime]::UtcNow -gt $deadline) { Write-Output 'audit-drive: TIMED OUT'; break }
    $raw = Get-Next
    if ($null -eq $raw) { continue }
    if ($raw -notlike '*"Runtime.bindingCalled"*') { continue }

    $evt = $raw | ConvertFrom-Json
    $name = $evt.params.name
    $payload = $evt.params.payload

    if ($name -eq '__auditDone') {
      Write-Output "audit-drive: harness reported done -- $payload"
      $done = $true
      continue
    }
    if ($name -ne '__auditShot') { continue }

    $req = $payload | ConvertFrom-Json
    $reply = $null
    try {
      # Clip tight to the requested points rather than the whole band: a sparse
      # band would otherwise encode a full 1440x900 PNG to read a dozen pixels.
      $xs = @($req.points | ForEach-Object { $_[0] })
      $ys = @($req.points | ForEach-Object { $_[1] })
      $x0 = [Math]::Max($req.rect.x, ([int](($xs | Measure-Object -Minimum).Minimum) - 2))
      $y0 = [Math]::Max($req.rect.y, ([int](($ys | Measure-Object -Minimum).Minimum) - 2))
      $x1 = [Math]::Min($req.rect.x + $req.rect.w, ([int](($xs | Measure-Object -Maximum).Maximum) + 3))
      $y1 = [Math]::Min($req.rect.y + $req.rect.h, ([int](($ys | Measure-Object -Maximum).Maximum) + 3))
      $cw = [Math]::Max(1, $x1 - $x0)
      $ch = [Math]::Max(1, $y1 - $y0)

      # PNG, never JPEG: this is a colour measurement.
      $rawShot = Invoke-CdpRaw 'Page.captureScreenshot' @{
        format = 'png'
        captureBeyondViewport = $false
        clip = @{ x = $x0; y = $y0; width = $cw; height = $ch; scale = 1 }
      }
      $m = [Regex]::Match($rawShot, '"data"\s*:\s*"([^"]+)"')
      if (-not $m.Success) { throw 'capture returned no data' }
      $bytes = [Convert]::FromBase64String($m.Groups[1].Value)
      $ms = New-Object System.IO.MemoryStream($bytes, $false)
      $bmp = [System.Drawing.Bitmap]::FromStream($ms)
      try {
        $cols = New-Object System.Collections.Generic.List[string]
        foreach ($p in $req.points) {
          $px = [int]$p[0] - $x0
          $py = [int]$p[1] - $y0
          if ($px -lt 0 -or $py -lt 0 -or $px -ge $bmp.Width -or $py -ge $bmp.Height) {
            $cols.Add($null); continue
          }
          $c = $bmp.GetPixel($px, $py)
          $cols.Add(('#{0:x2}{1:x2}{2:x2}' -f $c.R, $c.G, $c.B))
        }
        $points += $cols.Count
        $reply = @{ id = $req.id; colors = $cols } | ConvertTo-Json -Depth 4 -Compress
      } finally { $bmp.Dispose(); $ms.Dispose() }
      $shots++
      if ($shots % 25 -eq 0) {
        Write-Output ("  ... {0} captures, {1} points, {2}s elapsed" -f $shots, $points, [int]$swAll.Elapsed.TotalSeconds)
      }
    } catch {
      $reply = @{ id = $req.id; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }

    # Colour strings are hex only, so single-quoting the JSON is safe.
    [void](Invoke-Cdp 'Runtime.evaluate' @{
      expression = "window.__auditShotResult('" + $reply.Replace("'", "\'") + "')"
      returnByValue = $true
    })
  }

  Write-Output ("audit-drive: {0} captures, {1} pixels sampled, {2}s" -f $shots, $points, [int]$swAll.Elapsed.TotalSeconds)
  if (Test-Path $doneFile) {
    Write-Output 'audit-drive: results written --'
    Get-ChildItem $qaDir -File | ForEach-Object { Write-Output ("  {0}  {1} bytes" -f $_.Name, $_.Length) }
  } else {
    Write-Output 'audit-drive: WARNING -- AUDIT_DONE.txt was never written; the run did not finish cleanly.'
  }
} finally {
  try { $script:ws.Abort() } catch { }
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
    Where-Object { $_.CommandLine -like "*$profileDir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
