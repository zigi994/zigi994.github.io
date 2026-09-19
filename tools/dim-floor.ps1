<#
  dim-floor.ps1 -- find the lowest .showcase__step opacity that still passes AA.

  The stepper dims inactive steps to 0.34 and lights the active one. That is a
  resting state, not a transition, so two of every three steps sit permanently
  below AA -- the audit measured the label at 1.65:1. Raising the floor has to
  keep enough distance from the active step for the device to still read, so
  this sweeps candidate values and reports the real contrast of all three text
  roles at each, resolved from painted pixels rather than declared colour.
#>
param(
  [int]$Port = 8793,
  [double[]]$Candidates = @(0.34, 0.5, 0.58, 0.62, 0.66, 0.72, 0.8)
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path $PSScriptRoot -Parent

$serve = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
  '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repoRoot 'tools\serve.ps1'), '-Port', $Port
)

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$profile = Join-Path $env:TEMP "cv-dim-$(Get-Random)"
$cdpPort = 9800 + (Get-Random -Maximum 150)
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

  # Composited opacity means the declared colour is not the painted colour, so
  # every sample blends the resolved colour over the resolved ground manually --
  # same maths the browser uses for a non-opaque layer.
  $probe = @'
(op) => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  // Keep the alpha. Most foreground tokens here are one ink at varying alpha,
  // and that alpha multiplies with the ancestor opacity -- reading only rgb
  // reports every muted token as if it were the opaque ink and overstates the
  // ratio by well over a point.
  const px = (c) => { cv.clearRect(0,0,1,1); cv.fillStyle = '#000'; cv.fillStyle = c;
    cv.fillRect(0,0,1,1); const d = cv.getImageData(0,0,1,1).data;
    return { rgb: [d[0],d[1],d[2]], a: d[3] / 255 }; };
  const lum = ([r,g,b]) => { const f=(v)=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const cr = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m); return (x+0.05)/(y+0.05); };
  const over = (fg,bg,a) => fg.map((v,i)=>Math.round(bg[i]+(v-bg[i])*a));

  const step = [...document.querySelectorAll('.showcase__step')].find((s) => !s.classList.contains('is-active'));
  if (!step) return JSON.stringify({ err: 'no inactive step' });
  step.style.opacity = String(op);
  const ground = px(getComputedStyle(document.body).backgroundColor).rgb;

  const roles = { label: '.label', h3: 'h3', p: 'p', li: 'li' };
  const out = {};
  for (const [name, sel] of Object.entries(roles)) {
    const el = step.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const c = px(cs.color);
    const blended = over(c.rgb, ground, c.a * op);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    out[name] = {
      ratio: Number(cr(blended, ground).toFixed(2)),
      need: large ? 3 : 4.5,
      size: Math.round(size)
    };
  }
  return JSON.stringify(out);
}
'@

  # The label cannot be rescued by opacity alone -- 12px accent tops out at
  # 3.9:1 even at 0.8 -- so the second sweep asks which token it could carry
  # instead while the active step keeps the accent.
  $labelProbe = @'
(op) => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  // Alpha comes back too: --fg-1/2/3 are one ink at 0.82/0.72/0.64, so dropping
  // it makes all three look like opaque --fg-0. The token's own alpha multiplies
  // with the ancestor opacity, which is what actually reaches the screen.
  const px = (c) => { cv.clearRect(0,0,1,1); cv.fillStyle = '#000'; cv.fillStyle = c;
    cv.fillRect(0,0,1,1); const d = cv.getImageData(0,0,1,1).data;
    return { rgb: [d[0],d[1],d[2]], a: d[3] / 255 }; };
  const lum = ([r,g,b]) => { const f=(v)=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const cr = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m); return (x+0.05)/(y+0.05); };
  const over = (fg,bg,a) => fg.map((v,i)=>Math.round(bg[i]+(v-bg[i])*a));
  const step = [...document.querySelectorAll('.showcase__step')].find((s) => !s.classList.contains('is-active'));
  const label = step && step.querySelector('.label');
  if (!label) return JSON.stringify({ err: 'no label' });
  const ground = px(getComputedStyle(document.body).backgroundColor).rgb;
  const out = {};
  // Resolve each token by letting the engine compute it, not by handing the raw
  // declaration to canvas: these tokens are color-mix()/oklab(), which
  // fillStyle refuses, silently leaving the previous colour so every token
  // reads back identical.
  const probe = document.createElement('span');
  label.appendChild(probe);
  for (const tok of ['--fg-0','--fg-1','--fg-2','--fg-3','--accent','--accent-text']) {
    probe.style.color = `var(${tok})`;
    const resolved = getComputedStyle(probe).color;
    if (!resolved || resolved === 'rgba(0, 0, 0, 0)') continue;
    const c = px(resolved);
    const eff = c.a * op;
    out[tok] = {
      ratio: Number(cr(over(c.rgb, ground, eff), ground).toFixed(2)),
      rgb: resolved,
      eff: Number(eff.toFixed(2))
    };
  }
  probe.remove();
  return JSON.stringify(out);
}
'@

  $pages = @{ 'work/quchong.html' = 'light case'; '' = 'dark home' }
  foreach ($p in $pages.Keys) {
    Send-Cdp 'Page.navigate' @{ url = "http://localhost:$Port/$p`?df=$(Get-Random)" } | Out-Null
    foreach ($i in 1..80) { Start-Sleep -Milliseconds 200; if ((Eval 'document.readyState') -eq 'complete') { break } }
    Start-Sleep -Milliseconds 500
    $has = Eval 'document.querySelectorAll(".showcase__step").length'
    if (-not $has) { continue }
    Write-Output "=== $($pages[$p]) ($(if ($p) { $p } else { 'index' })) ==="
    foreach ($op in $Candidates) {
      $res = Eval "($probe)($op)" | ConvertFrom-Json
      if ($res.err) { Write-Output "  $op -> $($res.err)"; continue }
      $line = foreach ($role in 'label', 'h3', 'p', 'li') {
        if ($res.$role) {
          $v = $res.$role
          $mark = if ($v.ratio -ge $v.need) { '' } else { '!' }
          "{0} {1}:1{2}" -f $role, $v.ratio, $mark
        }
      }
      Write-Output ("  opacity {0,-5} {1}" -f $op, ($line -join '  '))
    }
    Write-Output "  -- label token options at 0.62 (12px, needs 4.5) --"
    $lab = Eval "($labelProbe)(0.62)" | ConvertFrom-Json
    if (-not $lab.err) {
      foreach ($tok in $lab.PSObject.Properties.Name) {
        $v = [double]$lab.$tok.ratio
        Write-Output ("     {0,-14} {1,5}:1 {2,-4}  {3}  eff-alpha {4}" -f $tok, $v, $(if ($v -ge 4.5) { 'pass' } else { 'FAIL' }), $lab.$tok.rgb, $lab.$tok.eff)
      }
    }
  }
  Write-Output '  ( ! = below its AA threshold )'
} finally {
  if ($proc -and -not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(5000) }
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
  if ($serve -and -not $serve.HasExited) { $serve.Kill(); $serve.WaitForExit(3000) }
}
