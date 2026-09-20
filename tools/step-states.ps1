<#
  step-states.ps1 -- contrast of every text role in the stepper, both states.

  The stepper used to de-emphasise inactive steps with a composited opacity,
  which multiplied into each token's own alpha and put the body copy at 1.83:1.
  It now demotes colour tiers instead, so both states have to be checked
  independently: the inactive one is the accessibility floor, and the gap
  between them is the focus device. Reports both plus the gap in luminance
  terms, so "does it still read as dimmed" is a number and not an opinion.

  Drives every case page that has a stepper. Non-zero exit if any role in
  either state misses its AA threshold.
#>
param(
  [int]$Port = 8795
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path $PSScriptRoot -Parent
$siteRoot = Join-Path $repoRoot 'zigi994'

$pages = Get-ChildItem (Join-Path $siteRoot 'work') -Filter '*.html' |
  Where-Object { (Get-Content $_.FullName -Raw) -match 'showcase__step' } |
  ForEach-Object { "work/$($_.Name)" }
if (-not $pages) { throw 'no page carries .showcase__step' }

$serve = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
  '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repoRoot 'tools\serve.ps1'), '-Port', $Port
)

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome not found' }

$profile = Join-Path $env:TEMP "cv-steps-$(Get-Random)"
$cdpPort = 9850 + (Get-Random -Maximum 120)
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
    param([string]$Method, [hashtable]$Params = @{})
    $script:msgId++; $mine = $script:msgId
    $bytes = [Text.Encoding]::UTF8.GetBytes((@{ id = $mine; method = $Method; params = $Params } | ConvertTo-Json -Depth 20 -Compress))
    $sock.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait(10000) | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(40)
    while ([DateTime]::UtcNow -lt $deadline) {
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
    if ($r.exceptionDetails) { throw "JS: $($r.exceptionDetails.text)" }
    return $r.result.value
  }

  Send-Cdp 'Page.enable' | Out-Null
  Send-Cdp 'Runtime.enable' | Out-Null
  Send-Cdp 'Network.setCacheDisabled' @{ cacheDisabled = $true } | Out-Null

  $probe = @'
(() => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const px = (c) => { cv.clearRect(0,0,1,1); cv.fillStyle = '#000'; cv.fillStyle = c;
    cv.fillRect(0,0,1,1); const d = cv.getImageData(0,0,1,1).data;
    return { rgb: [d[0],d[1],d[2]], a: d[3] / 255 }; };
  const lum = ([r,g,b]) => { const f=(v)=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const cr = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m); return (x+0.05)/(y+0.05); };
  const over = (fg,bg,a) => fg.map((v,i)=>Math.round(bg[i]+(v-bg[i])*a));

  const steps = [...document.querySelectorAll('.showcase__step')];
  if (steps.length < 2) return JSON.stringify({ err: 'need 2 steps' });
  const ground = px(getComputedStyle(document.body).backgroundColor).rgb;
  const roles = { label: ':scope > .label', h3: 'h3', p: 'p', li: 'li' };

  // Force one of each state rather than trusting whatever scroll position the
  // harness happens to be at.
  steps.forEach((s, i) => s.classList.toggle('is-active', i === 0));

  const read = (step) => {
    const o = {};
    for (const [name, sel] of Object.entries(roles)) {
      const el = step.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const c = px(cs.color);
      const size = parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      o[name] = {
        ratio: Number(cr(over(c.rgb, ground, c.a), ground).toFixed(2)),
        need: large ? 3 : 4.5,
        size: Math.round(size),
        lum: Number(lum(over(c.rgb, ground, c.a)).toFixed(4))
      };
    }
    return o;
  };

  return JSON.stringify({ active: read(steps[0]), idle: read(steps[1]) });
})()
'@

  $fails = 0
  foreach ($p in $pages) {
    Send-Cdp 'Page.navigate' @{ url = "http://localhost:$Port/$p`?ss=$(Get-Random)" } | Out-Null
    foreach ($i in 1..80) { Start-Sleep -Milliseconds 200; if ((Eval 'document.readyState') -eq 'complete') { break } }
    Start-Sleep -Milliseconds 400
    $m = Eval $probe | ConvertFrom-Json
    if ($m.err) { Write-Output "  $p -> $($m.err)"; continue }
    Write-Output "=== $($p -replace '^work/|\.html$','') ==="
    foreach ($role in 'label', 'h3', 'p', 'li') {
      if (-not $m.active.$role) { continue }
      $a = $m.active.$role
      $d = $m.idle.$role
      $aOk = if ([double]$a.ratio -ge [double]$a.need) { 'ok  ' } else { 'FAIL' }
      $dOk = if ([double]$d.ratio -ge [double]$d.need) { 'ok  ' } else { 'FAIL' }
      if ($aOk -eq 'FAIL' -or $dOk -eq 'FAIL') { $fails++ }
      # Perceived separation: how much lighter the idle role sits than the
      # active one. Under the old opacity dim this was the whole effect.
      $gap = [math]::Round(([double]$d.lum - [double]$a.lum) / [math]::Max([double]$a.lum, 0.0001), 2)
      Write-Output ("  {0,-6} {1,2}px  active {2,6}:1 {3}  idle {4,6}:1 {5}  needs {6}  separation x{7}" -f `
        $role, $a.size, $a.ratio, $aOk, $d.ratio, $dOk, $a.need, $gap)
    }
  }
  Write-Output ''
  Write-Output "  roles below AA: $fails"
  if ($fails) { exit 1 }
} finally {
  if ($proc -and -not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(5000) }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
  if ($serve -and -not $serve.HasExited) { $serve.Kill(); $serve.WaitForExit(3000) }
}
