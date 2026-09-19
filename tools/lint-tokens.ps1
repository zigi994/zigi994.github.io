<#
  lint-tokens.ps1 -- design-system rules that a contrast audit cannot catch

  WHY THIS EXISTS
    tools/audit.html measures what is painted, so it only sees the pages and
    states that exist today. It cannot tell you that a declaration is written
    wrongly and merely happens to be masked by a later override, nor that a new
    component forgot to opt into a convention. Both went wrong while .reframe
    was being added:

      1. .reframe__row--found set its accent seam with var(--accent-text) in the
         base rule and var(--accent) inside @media (max-width: 860px). Against
         bone those measure 5.7:1 and 1.9:1, so every phone got an invisible
         seam while every desktop audit passed.

      2. What made that possible: accent-on-light is carried by a
         hand-maintained list of :root[data-theme="light"] overrides. A
         component is correct only if its author remembers to register there,
         and nothing fails when they forget.

  THE RULES
    A  var(--accent) used as a foreground -- colour, border, outline, fill,
       stroke -- in a stylesheet that serves at least one light page, where the
       rule is not registered in the light override list. On a dark ground
       tokens.css defines --accent-text as var(--accent), so the darkened tier
       is always the safe spelling; the raw token belongs to fills, gradients
       and materials, where being quiet is the point.
       Registered rules are reported separately as advisory: they are correct
       today, and they are also the reason the convention is fragile.
    B  one selector using different accent tiers in its base rule and in one of
       its own media queries. Compared per selector, not per property, because
       fault 1 above switched from border-inline-start to border-block-start on
       the way -- a per-property check walks straight past it.
    C  var(--x) where nothing declares --x. Runtime-injected properties are
       excluded two ways: a var() that supplies a fallback is taken as
       deliberate, and scripts/*.js is scanned for setProperty names.

  USAGE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\lint-tokens.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\lint-tokens.ps1 -SelfTest
    Exit code is the number of errors, advisories excluded, so it can gate a commit.
#>

param(
  [switch]$SelfTest,      # run the rules against fixtures with known faults
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path $PSScriptRoot -Parent
$siteRoot = Join-Path $repoRoot 'zigi994'

# Colour lands as a mark the reader must see. Backgrounds and gradients are
# deliberately absent: a 4% accent wash is meant to be barely there, and pushing
# it through the darkened tier would only make it dirty.
$FG_PROP = '(?:color|-webkit-text-fill-color|outline|outline-color|border|border-color|border-(?:top|right|bottom|left|block|inline)(?:-start|-end)?(?:-color)?|fill|stroke|text-decoration-color|caret-color|column-rule(?:-color)?)'

# Nested scopes that re-establish a dark ground; tokens.css redeclares
# --accent-text: var(--accent) inside these, so raw accent is correct there.
$DARK_SCOPE = 'data-theme="dark"|\.device|\.nodeui|\.nnode|\.phone|\.screen--|\.chashi-viz|\.mock|\.vt-|\.poster|\.preset|\.wires|\.dial|\.hero-screens'

function Get-CssRules {
  param([string]$Path)
  $lines = Get-Content $Path -Encoding UTF8
  $rules = New-Object System.Collections.Generic.List[object]
  $inComment = $false
  $sel = ''
  $media = ''
  $depth = 0

  for ($i = 0; $i -lt $lines.Count; $i++) {
    $raw = $lines[$i]
    if ($inComment) { if ($raw -match '\*/') { $inComment = $false }; continue }
    if ($raw -match '/\*' -and $raw -notmatch '\*/') { $inComment = $true; continue }
    $l = ($raw -replace '/\*.*?\*/', '')
    if ($l.Trim() -eq '') { continue }

    if ($l -match '^\s*@media') {
      $media = ($l -replace '^\s*@media\s*', '' -replace '\s*\{\s*$', '').Trim()
      $depth++
      continue
    }
    if ($l -match '^\s*@(?:supports|keyframes|font-face|layer|container)') { $depth++; continue }

    if ($l -match '\{\s*$') { $sel = ($l -replace '\s*\{\s*$', '').Trim(); continue }

    if ($l -match '^\s*\}') {
      if ($sel -ne '') { $sel = '' }
      elseif ($depth -gt 0) { $depth--; if ($depth -eq 0) { $media = '' } }
      continue
    }

    if ($sel -ne '' -and $l -match ':') {
      $rules.Add([pscustomobject]@{
        Line = $i + 1; Selector = $sel; Media = $media; Decl = $l.Trim()
      })
    }
  }
  return $rules
}

function Invoke-Lint {
  param(
    [string]$StylesDir,
    [hashtable]$SheetThemes,     # file name -> 'dark' | 'light' | 'dark+light'
    [string[]]$RuntimeProps
  )

  $sheets = Get-ChildItem $StylesDir -Filter *.css | Sort-Object Name
  $errors = New-Object System.Collections.Generic.List[string]
  $advice = New-Object System.Collections.Generic.List[string]

  $declared = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($p in $RuntimeProps) { [void]$declared.Add($p) }
  $registered = New-Object 'System.Collections.Generic.HashSet[string]'
  $parsed = @{}

  foreach ($s in $sheets) {
    $raw = Get-Content $s.FullName -Raw -Encoding UTF8
    foreach ($m in [regex]::Matches($raw, '(--[a-zA-Z0-9-]+)\s*:')) { [void]$declared.Add($m.Groups[1].Value) }
    # every selector carried by the light override list, however it is grouped
    foreach ($m in [regex]::Matches($raw, ':root\[data-theme="light"\]\s*([^,{]+)')) {
      $t = $m.Groups[1].Value.Trim()
      if ($t) { [void]$registered.Add($t) }
    }
    $parsed[$s.Name] = Get-CssRules $s.FullName
  }

  foreach ($s in $sheets) {
    $theme = if ($SheetThemes.ContainsKey($s.Name)) { $SheetThemes[$s.Name] } else { 'dark+light' }
    $servesLight = $theme -match 'light'
    $tiers = @{}   # selector -> @{ base = HashSet; media = @{cond = HashSet} }

    foreach ($r in $parsed[$s.Name]) {
      $isFg = $r.Decl -match ('^' + $FG_PROP + '\s*:')

      # ---- A ----------------------------------------------------------------
      if ($isFg -and $r.Decl -match 'var\(\s*--accent\s*\)' -and $r.Decl -notmatch 'color-mix') {
        $ctx = "$($r.Selector) $($r.Media)"
        if ($servesLight -and $ctx -notmatch $DARK_SCOPE) {
          $msg = ("{0}:{1}`n       rule: {2}`n       {3}" -f $s.Name, $r.Line, $r.Selector, $r.Decl)
          if ($registered.Contains($r.Selector)) {
            $advice.Add("A  $msg`n       (registered in the light override list, so correct today)")
          } else {
            $errors.Add("A  $msg`n       not registered for light -- would paint raw accent on bone")
          }
        }
      }

      # ---- B ----------------------------------------------------------------
      if ($isFg -and $r.Decl -match 'var\(\s*--accent(-text)?\s*\)') {
        $tier = if ($r.Decl -match 'var\(\s*--accent-text\s*\)') { 'accent-text' } else { 'accent' }
        if (-not $tiers.ContainsKey($r.Selector)) {
          $tiers[$r.Selector] = @{ base = @{}; media = @{} }
        }
        if ($r.Media -eq '') {
          $tiers[$r.Selector].base[$tier] = $r.Line
        } else {
          if (-not $tiers[$r.Selector].media.ContainsKey($r.Media)) { $tiers[$r.Selector].media[$r.Media] = @{} }
          $tiers[$r.Selector].media[$r.Media][$tier] = $r.Line
        }
      }

      # ---- C ----------------------------------------------------------------
      foreach ($m in [regex]::Matches($r.Decl, 'var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?')) {
        $name = $m.Groups[1].Value
        $hasFallback = $m.Groups[2].Success
        if (-not $hasFallback -and -not $declared.Contains($name)) {
          $errors.Add(("C  {0}:{1}  var({2}) is never declared and has no fallback`n       {3}" -f $s.Name, $r.Line, $name, $r.Decl))
        }
      }
    }

    foreach ($sel in $tiers.Keys) {
      $baseTiers = @($tiers[$sel].base.Keys)
      if ($baseTiers.Count -eq 0) { continue }
      foreach ($cond in $tiers[$sel].media.Keys) {
        $mTiers = @($tiers[$sel].media[$cond].Keys)
        # @() matters: a single-element Where-Object result is a bare string, and
        # indexing a string yields its first character -- which read back as an
        # empty line number instead of the tier name.
        $diff = @($mTiers | Where-Object { $baseTiers -notcontains $_ })
        if ($diff.Count) {
          $errors.Add(("B  {0}:{1}  accent tier changes inside @media`n       rule: {2}`n       base uses --{3} (L{4}), @media {5} uses --{6}" -f `
            $s.Name, $tiers[$sel].media[$cond][$diff[0]], $sel, ($baseTiers -join '/'),
            $tiers[$sel].base[$baseTiers[0]], $cond, ($diff -join '/')))
        }
      }
    }
  }

  return @{ Errors = $errors; Advice = $advice }
}

# ---------------------------------------------------------------------------
if ($SelfTest) {
  $fix = Join-Path $env:TEMP ('lint-tokens-selftest-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $fix | Out-Null
  # Fault 1 exactly as it was written, plus a clean control and an A case.
  @'
:root { --accent: #9db37f; --accent-text: #4e6136; }
.seam {
  border-inline-start: 2px solid var(--accent-text);
}
@media (max-width: 860px) {
  .seam {
    border-inline-start: 0;
    border-block-start: 2px solid var(--accent);
  }
}
.clean {
  border-inline-start: 2px solid var(--accent-text);
}
@media (max-width: 860px) {
  .clean { border-block-start: 2px solid var(--accent-text); }
}
.unregistered-mark { color: var(--accent); }
'@ | Set-Content (Join-Path $fix 'case.css') -Encoding UTF8

  $res = Invoke-Lint -StylesDir $fix -SheetThemes @{ 'case.css' = 'light' } -RuntimeProps @()
  Remove-Item $fix -Recurse -Force

  $b = @($res.Errors | Where-Object { $_ -like 'B *' })
  $a = @($res.Errors | Where-Object { $_ -like 'A *' })
  Write-Output 'lint-tokens self-test'
  Write-Output ''
  Write-Output ("  rule B (the seam fault, property name changes)   {0}" -f $(if ($b.Count -eq 1) { 'CAUGHT' } else { "FAILED -- $($b.Count) hits, expected 1" }))
  Write-Output ("  rule B (clean control, same tier both sides)     {0}" -f $(if ($b.Count -eq 1) { 'no false positive' } else { 'see above' }))
  Write-Output ("  rule A (unregistered raw accent foreground)      {0}" -f $(if ($a.Count -eq 1) { 'CAUGHT' } else { "FAILED -- $($a.Count) hits, expected 1" }))
  Write-Output ''
  $res.Errors | ForEach-Object { Write-Output "  $_"; Write-Output '' }
  exit $(if ($b.Count -eq 1 -and $a.Count -eq 1) { 0 } else { 1 })
}

# ---- which sheets can ever paint on a light ground? ------------------------
$sheetThemes = @{}
$pages = @(Get-ChildItem (Join-Path $siteRoot 'index.html'), (Join-Path $siteRoot 'work\*.html') -ErrorAction SilentlyContinue)
foreach ($s in (Get-ChildItem (Join-Path $siteRoot 'styles') -Filter *.css)) {
  $seen = @()
  foreach ($h in $pages) {
    $raw = Get-Content $h.FullName -Raw -Encoding UTF8
    if ($raw -match [regex]::Escape($s.Name)) {
      $seen += $(if ($raw -match 'data-theme="light"') { 'light' } else { 'dark' })
    }
  }
  $sheetThemes[$s.Name] = (($seen | Sort-Object -Unique) -join '+')
}

# Custom properties written from JS are declared nowhere in CSS by design.
$runtime = @()
foreach ($j in (Get-ChildItem (Join-Path $siteRoot 'scripts') -Filter *.js -ErrorAction SilentlyContinue)) {
  $raw = Get-Content $j.FullName -Raw -Encoding UTF8
  foreach ($m in [regex]::Matches($raw, 'setProperty\(\s*["''](--[a-zA-Z0-9-]+)')) { $runtime += $m.Groups[1].Value }
}
$runtime = $runtime | Sort-Object -Unique

$res = Invoke-Lint -StylesDir (Join-Path $siteRoot 'styles') -SheetThemes $sheetThemes -RuntimeProps $runtime

if (-not $Quiet) {
  Write-Output 'lint-tokens'
  ($sheetThemes.Keys | Sort-Object) | ForEach-Object { "  {0,-16} serves [{1}]" -f $_, $sheetThemes[$_] } | Write-Output
  if ($runtime.Count) { Write-Output "  runtime props from JS: $($runtime -join ' ')" }
  Write-Output ''
}

if ($res.Errors.Count -eq 0) { Write-Output 'errors:    none' }
else {
  Write-Output "errors:    $($res.Errors.Count)"
  Write-Output ''
  $res.Errors | ForEach-Object { Write-Output "  $_"; Write-Output '' }
}

if ($res.Advice.Count) {
  Write-Output "advisory:  $($res.Advice.Count) rule(s) rely on the light override list"
  if (-not $Quiet) { Write-Output ''; $res.Advice | ForEach-Object { Write-Output "  $_"; Write-Output '' } }
}

exit $res.Errors.Count
