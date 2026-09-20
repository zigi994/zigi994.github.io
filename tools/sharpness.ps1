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
  return JSON.stringify(imgs.map((i) => {
    const r = i.getBoundingClientRect();
    const cs = getComputedStyle(i);
    return {
      src: (i.currentSrc || i.src).split('/').slice(-2).join('/'),
      nat: [i.naturalWidth, i.naturalHeight],
      box: [Math.round(r.width), Math.round(r.height)],
      dpr,
      fit: cs.objectFit
    };
  }).filter((x) => x.nat[0] > 0 && x.box[0] > 0));
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
          # object-fit: cover crops, so the demand is set by whichever axis has
          # to cover -- taking width alone understates it on tall crops.
          $sx = $r.box[0] * $r.dpr / $r.nat[0]
          $sy = $r.box[1] * $r.dpr / $r.nat[1]
          $starved = if ($r.fit -eq 'cover') { [math]::Max($sx, $sy) } else { $sx }
          $all += [pscustomobject]@{
            File = $r.src; Page = if ($p) { $p -replace '^work/|\.html$', '' } else { 'index' }
            Vw = $w; Dpr = $r.dpr; Nat = "$($r.nat[0])x$($r.nat[1])"
            Box = "$($r.box[0])x$($r.box[1])"; Starved = [math]::Round($starved, 2)
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
      $w.File, $w.Nat, $w.Box, $w.Dpr, $w.Page, $w.Starved, $mark)
  }
  $soft = @($worst | Where-Object { $_.Starved -ge $Flag })
  Write-Output ''
  Write-Output "  upscaled files: $($soft.Count) / $($worst.Count)"
} finally {
  if ($proc -and -not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(5000) }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
  if ($serve -and -not $serve.HasExited) { $serve.Kill(); $serve.WaitForExit(3000) }
}
