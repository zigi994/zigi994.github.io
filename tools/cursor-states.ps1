<#
  cursor-states.ps1 -- the custom cursor must never be drawn away from the pointer.

  Written after a bug that survived two fixes because the test was wrong, not
  the theory. The ring is positioned by a JS-written `transform`, while CSS also
  declared `translate` and (on the pressed state) `scale`. The individual
  transform properties always apply before `transform`, so `scale: 0.82`
  multiplied the coordinates: at (1120, 300) the ring rendered at (918, 246).

  The earlier test dispatched mousePressed and mouseReleased back to back, so
  the pressed class never survived a paint and the sampler only ever saw the
  idle matrix. So this checks two things, and the first is the one that matters:

    1. STATIC -- for every combination of the state classes, put the ring at a
       known point and compare the rendered centre against it. Position is a
       geometry question and needs no input events at all, which is what makes
       it reliable. Also samples near the far corner, since a multiplied
       coordinate drifts in proportion to its distance from the origin.

    2. LIVE -- a real press that is *held* across frames, sampling every frame
       from mousedown to after mouseup, because that is the sequence a hand
       produces and the one the earlier test skipped.

  Non-zero exit if anything drifts more than 1px from the pointer.
#>
param(
  [string]$Target = '',
  [int]$Port = 8788,
  [double]$Tolerance = 1.0
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path $PSScriptRoot -Parent
$serve = $null
if (-not $Target) {
  $serve = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repoRoot 'tools\serve.ps1'), '-Port', $Port
  )
  $Target = "http://localhost:$Port"
}

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome not found' }

$profile = Join-Path $env:TEMP "cv-cursor-$(Get-Random)"
$cdpPort = 9500 + (Get-Random -Maximum 90)
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
    $dl = [DateTime]::UtcNow.AddSeconds(40)
    while ([DateTime]::UtcNow -lt $dl) {
      $buf = [byte[]]::new(1048576); $sb = [Text.StringBuilder]::new()
      do {
        $r = $sock.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None)
        if (-not $r.Wait(20000)) { throw "timeout $Method" }
        [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Result.Count))
      } while (-not $r.Result.EndOfMessage)
      $o = $sb.ToString() | ConvertFrom-Json
      if ($o.id -eq $mine) { if ($o.error) { throw "$Method -> $($o.error.message)" }; return $o.result }
    }
    throw "no reply $Method"
  }
  function Eval { param([string]$E)
    $r = Send-Cdp 'Runtime.evaluate' @{ expression = $E; returnByValue = $true; awaitPromise = $true }
    if ($r.exceptionDetails) { throw "JS: $($r.exceptionDetails.text) $($r.exceptionDetails.exception.description)" }
    return $r.result.value
  }

  Send-Cdp 'Page.enable' | Out-Null
  Send-Cdp 'Runtime.enable' | Out-Null
  Send-Cdp 'Network.setCacheDisabled' @{ cacheDisabled = $true } | Out-Null

  $pages = @('', 'work/quchong.html')
  $fails = 0

  foreach ($p in $pages) {
    $url = "$Target/$p" + "?cs=$(Get-Random)"
    Send-Cdp 'Page.navigate' @{ url = $url } | Out-Null
    foreach ($i in 1..80) { Start-Sleep -Milliseconds 200; if ((Eval 'document.readyState') -eq 'complete') { break } }
    Start-Sleep -Milliseconds 600

    $label = if ($p) { $p -replace '\.html$', '' } else { 'index' }
    if (-not (Eval 'Boolean(document.querySelector(".cursor__ring"))')) {
      Write-Output "=== $label ===  no cursor (fine-pointer gate) -- skipped"
      continue
    }
    Write-Output "=== $label ==="

    # ---- 1. static geometry, every state combination, two positions ----
    $static = Eval @'
(() => {
  const root = document.querySelector('.cursor');
  const layers = { dot: document.querySelector('.cursor__dot'), ring: document.querySelector('.cursor__ring') };
  const states = ['', 'is-down', 'is-hovering', 'is-labelled',
                  'is-down is-hovering', 'is-down is-labelled'];
  const spots = [[120, 120], [1320, 820]];
  const out = [];
  const keep = root.className;
  for (const st of states) {
    root.className = ('cursor ' + st).trim();
    for (const [x, y] of spots) {
      for (const [name, el] of Object.entries(layers)) {
        if (!el) continue;
        // Reproduce what the ticker writes, then read what was rendered.
        el.style.transform =
          `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${st.includes('is-down') ? 0.82 : 1})`;
        const r = el.getBoundingClientRect();
        out.push({
          state: st || 'idle', layer: name, want: [x, y],
          got: [Math.round((r.left + r.width / 2) * 10) / 10, Math.round((r.top + r.height / 2) * 10) / 10],
          size: Math.round(r.width)
        });
      }
    }
  }
  root.className = keep;
  return JSON.stringify(out);
})()
'@ | ConvertFrom-Json

    foreach ($s in $static) {
      $dx = [math]::Abs($s.got[0] - $s.want[0])
      $dy = [math]::Abs($s.got[1] - $s.want[1])
      $bad = ($dx -gt $Tolerance -or $dy -gt $Tolerance)
      if ($bad) {
        $fails++
        Write-Output ("  DRIFT  {0,-22} {1,-4} want {2},{3}  got {4},{5}  off by {6},{7}" -f `
          $s.state, $s.layer, $s.want[0], $s.want[1], $s.got[0], $s.got[1], [math]::Round($s.got[0]-$s.want[0],1), [math]::Round($s.got[1]-$s.want[1],1))
      }
    }
    $worst = ($static | ForEach-Object {
      [math]::Max([math]::Abs($_.got[0] - $_.want[0]), [math]::Abs($_.got[1] - $_.want[1]))
    } | Measure-Object -Maximum).Maximum
    Write-Output ("  static:  {0} combinations, worst offset {1}px" -f $static.Count, [math]::Round($worst, 2))

    # ---- 2. a held press, sampled every frame ----
    $px = 1180; $py = 640
    Send-Cdp 'Input.dispatchMouseEvent' @{ type = 'mouseMoved'; x = $px; y = $py; buttons = 0 } | Out-Null
    Start-Sleep -Milliseconds 500   # let the trailing ring settle onto the pointer

    $sampler = @"
(() => {
  const ring = document.querySelector('.cursor__ring');
  const seen = [];
  let n = 0;
  return new Promise((res) => {
    const tick = () => {
      const r = ring.getBoundingClientRect();
      seen.push([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), Math.round(r.width)]);
      if (++n < 46) requestAnimationFrame(tick);
      else res(JSON.stringify(seen));
    };
    requestAnimationFrame(tick);
  });
})()
"@

    # Hold the button down across the sampling window: press, sample, release,
    # sample again. A press and release in one task never survives a paint.
    Send-Cdp 'Input.dispatchMouseEvent' @{ type = 'mousePressed'; x = $px; y = $py; button = 'left'; clickCount = 1; buttons = 1 } | Out-Null
    $held = Eval $sampler | ConvertFrom-Json
    Send-Cdp 'Input.dispatchMouseEvent' @{ type = 'mouseReleased'; x = $px; y = $py; button = 'left'; clickCount = 1; buttons = 0 } | Out-Null
    $after = Eval $sampler | ConvertFrom-Json

    $all = @($held) + @($after)
    $off = $all | ForEach-Object {
      [math]::Sqrt([math]::Pow($_[0] - $px, 2) + [math]::Pow($_[1] - $py, 2))
    }
    $maxOff = [math]::Round(($off | Measure-Object -Maximum).Maximum, 1)
    $sizes = ($all | ForEach-Object { $_[2] } | Sort-Object -Unique) -join '/'
    if ($maxOff -gt $Tolerance) {
      $fails++
      Write-Output ("  DRIFT  held press wandered {0}px from the pointer" -f $maxOff)
    }
    Write-Output ("  live:    {0} frames across press+release, worst {1}px off, ring {2}px" -f $all.Count, $maxOff, $sizes)
    # The press has to actually be visible, or this proves nothing.
    if (($all | ForEach-Object { $_[2] } | Sort-Object -Unique).Count -lt 2) {
      $fails++
      Write-Output '  FAILED  the ring never changed size -- the press was not exercised'
    }
  }

  Write-Output ''
  Write-Output "  failures: $fails"
  if ($fails) { exit 1 }
} finally {
  if ($proc -and -not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(5000) }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
  if ($serve -and -not $serve.HasExited) { $serve.Kill(); $serve.WaitForExit(3000) }
}
