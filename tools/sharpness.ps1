<#
  sharpness.ps1 -- which images are actually being asked for more pixels than they have.

  "Low resolution" is not a property of a file, it is a relationship between the
  file and the box it is painted into. A 1024px render is pristine in a 400px
  frame and mush across a 1440px hero. So this measures, for every <img> on
  every page and at each viewport: natural pixels, the rendered CSS box, the
  device pixel ratio, and the ratio between what the screen asks for and what
  the file can supply.

    demand = rendered CSS width x DPR
    supply = naturalWidth
    starved = demand / supply     > 1 means upscaled, i.e. soft

  Reports the worst case per file, because one page showing it small does not
  excuse another page stretching it. Checks DPR 2 as well as 1: every retina
  laptop and phone doubles the demand, which is where soft images actually get
  noticed.
#>
param(
  [int]$Port = 8792,
  [double]$Flag = 1.15
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path $PSScriptRoot -Parent
$siteRoot = Join-Path $repoRoot 'zigi994'

$pages = @('')
Get-ChildItem (Join-Path $siteRoot 'work') -Filter '*.html' | ForEach-Object { $pages += "work/$($_.Name)" }

$serve = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repoRoot 'tools\serve.ps1'), '-Port', $Port
)

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome not found' }

$profile = Join-Path $env:TEMP "cv-sharp-$(Get-Random)"
$cdpPort = 9300 + (Get-Random -Maximum 150)
$proc = $null

try {
  Start-Sleep -Seconds 2
  $proc = Start-Process $chrome -PassThru -ArgumentList @(
    '--headless=new', "--remote-debugging-port=$cdpPort", "--user-data-dir=$profile",
    '--window-size=1440,900', '--hide-scrollbars', '--no-first-run',
    '--disable-extensions', 'about:blank'
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
    $dl = [DateTime]::UtcNow.AddSeconds(50)
    while ([DateTime]::UtcNow -lt $dl) {
      $buf = [byte[]]::new(4194304); $sb = [Text.StringBuilder]::new()
      do {
        $r = $sock.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None)
        if (-not $r.Wait(25000)) { throw "timeout $Method" }
        [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Result.Count))
      } while (-not $r.Result.EndOfMessage)
      $o = $sb.ToString() | ConvertFrom-Json
      if ($o.id -eq $mine) { if ($o.error) { throw "$Method -> $($o.error.message)" }; return $o.result }
    }
    throw "no reply $Method"
  }
  function Eval { param([string]$E)
    $r = Send-Cdp 'Runtime.evaluate' @{ expression = $E; returnByValue = $true; awaitPromise = $true }
    if ($r.exceptionDetails) { throw "JS: $($r.exceptionDetails.text)" }
    return $r.result.value
  }

  Send-Cdp 'Page.enable' | Out-Null
  Send-Cdp 'Runtime.enable' | Out-Null

  # naturalWidth is 0 until the bytes arrive, and most of these are lazy. Forcing
  # eager and awaiting decode is both faster and more deterministic than walking
  # the page -- these documents run to 12000px and the scroll walk timed out.
  $probe = @'
(async () => {
  const imgs = [...document.images];
  imgs.forEach((i) => { i.loading = 'eager'; if (!i.src && i.dataset.src) i.src = i.dataset.src; });
  await Promise.all(imgs.map((i) => new Promise((res) => {
    if (i.complete && i.naturalWidth) return res();
    i.addEventListener('load', res, { once: true });
    i.addEventListener('error', res, { once: true });
    setTimeout(res, 6000);
  })));
  const dpr = window.devicePixelRatio;
  const measured = await Promise.all(imgs.map(async (i) => {
    const url = i.currentSrc || i.src;

    /* With width-descriptor srcset, HTMLImageElement.naturalWidth is
       density-corrected to a CSS intrinsic width. It is not the pixel width of
       the selected file, so using it would report a correctly selected 480px
       candidate as 160px on a 3x slot. Decode currentSrc without srcset to get
       the actual bitmap supply. */
    const raw = new Image();
    raw.src = url;
    try { await raw.decode(); } catch {}
    const naturalWidth = raw.naturalWidth || i.naturalWidth;
    const naturalHeight = raw.naturalHeight || i.naturalHeight;

    const r = i.getBoundingClientRect();
    const cs = getComputedStyle(i);
    let paintW = r.width, paintH = r.height, crop = 0;
    const sx = r.width / naturalWidth;
    const sy = r.height / naturalHeight;
    if (cs.objectFit === 'contain') {
      const s = Math.min(sx, sy);
      paintW = naturalWidth * s;
      paintH = naturalHeight * s;
    } else if (cs.objectFit === 'cover') {
      const s = Math.max(sx, sy);
      const fullW = naturalWidth * s;
      const fullH = naturalHeight * s;
      crop = 1 - Math.min(1, r.width / fullW) * Math.min(1, r.height / fullH);
    }
    const path = new URL(url).pathname;
    return {
      src: path.split('/').slice(-2).join('/'),
      nat: [naturalWidth, naturalHeight],
      box: [Math.round(r.width), Math.round(r.height)],
      paint: [Math.round(paintW), Math.round(paintH)],
      dpr,
      fit: cs.objectFit,
      crop,
      vector: /\.svg$/i.test(path),
      declared: i.hasAttribute('width') && i.hasAttribute('height')
    };
  }));
  return JSON.stringify(measured.filter((x) => x.nat[0] > 0 && x.box[0] > 0));
})()
'@

  $all = @()
  foreach ($dpr in 1, 2) {
    foreach ($w in 1440, 390) {
      Send-Cdp 'Emulation.setDeviceMetricsOverride' @{
        width = $w; height = 900; deviceScaleFactor = $dpr; mobile = ($w -lt 700)
      } | Out-Null
      foreach ($p in $pages) {
        Send-Cdp 'Page.navigate' @{ url = "http://localhost:$Port/$p`?sh=$(Get-Random)" } | Out-Null
        foreach ($i in 1..90) { Start-Sleep -Milliseconds 200; if ((Eval 'document.readyState') -eq 'complete') { break } }
        $res = Eval $probe | ConvertFrom-Json
        foreach ($r in @($res)) {
          # Use the painted image, not the <img> element's box. A contained
          # square inside a 16:9 frame owns the full box in CSS but only paints
          # into its height; counting the empty side bands made every cutout
          # look 2x softer than it really was. SVG is resolution-independent.
          $sx = $r.paint[0] * $r.dpr / $r.nat[0]
          $sy = $r.paint[1] * $r.dpr / $r.nat[1]
          $starved = if ($r.vector) { 0 } else { [math]::Max($sx, $sy) }
          $all += [pscustomobject]@{
            File = $r.src; Page = if ($p) { $p -replace '^work/|\.html$', '' } else { 'index' }
            Vw = $w; Dpr = $r.dpr; Nat = "$($r.nat[0])x$($r.nat[1])"
            Box = "$($r.box[0])x$($r.box[1])"; Paint = "$($r.paint[0])x$($r.paint[1])"
            Starved = [math]::Round($starved, 2); Crop = [math]::Round($r.crop * 100)
            Declared = [bool]$r.declared
          }
        }
      }
    }
  }

  Write-Output '=== worst case per file (demand / supply; >1 means upscaled) ==='
  $worst = $all | Group-Object File | ForEach-Object {
    $w = $_.Group | Sort-Object Starved -Descending | Select-Object -First 1
    $w
  } | Sort-Object Starved -Descending

  foreach ($w in $worst) {
    $mark = if ($w.Starved -ge $Flag) { '  <-- soft' } else { '' }
    Write-Output ("  {0,-28} {1,10} -> {2,9} @{3}x {4,-8} x{5}{6}" -f `
      $w.File, $w.Nat, $w.Paint, $w.Dpr, $w.Page, $w.Starved, $mark)
  }
  $soft = @($worst | Where-Object { $_.Starved -ge $Flag })
  Write-Output ''
  Write-Output "  upscaled files: $($soft.Count) / $($worst.Count)"

  $cropped = @($all | Where-Object { $_.Crop -ge 15 } |
    Sort-Object Crop -Descending |
    Group-Object File,Page |
    ForEach-Object { $_.Group | Select-Object -First 1 })
  Write-Output ''
  Write-Output '=== intentional cover crops >= 15% (review composition) ==='
  foreach ($c in $cropped) {
    Write-Output ("  {0,-28} {1,-12} {2,3}% cropped  box {3}" -f $c.File, $c.Page, $c.Crop, $c.Box)
  }

  $missingDimensions = @($all | Where-Object { -not $_.Declared } |
    Group-Object File | ForEach-Object { $_.Group | Select-Object -First 1 })
  Write-Output ''
  Write-Output "  images missing width/height: $($missingDimensions.Count)"
} finally {
  if ($proc -and -not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(5000) }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
  if ($serve -and -not $serve.HasExited) { $serve.Kill(); $serve.WaitForExit(3000) }
}
