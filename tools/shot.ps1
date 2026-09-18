<#
  Headless screenshot helper.

  There is no image toolchain on this machine, so Chrome is the renderer for
  both QA captures and the asset pipeline. Two things here are deliberate:

  - a single reusable profile directory, cleaned on exit, because earlier runs
    left ~100 orphaned processes and 1.8 GB of Temp profiles behind;
  - --force-prefers-reduced-motion, so captures show the settled layout instead
    of whatever frame the reveal animations happened to be on.
#>
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1500,
  [int]$Height = 1000,
  [int]$SettleMs = 2600,
  [switch]$FullPage,
  [switch]$AllowMotion
)

$ErrorActionPreference = 'Stop'

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
New-Item -ItemType Directory -Force -Path (Split-Path $Out -Parent) | Out-Null

$args = @(
  '--headless=new'
  '--disable-gpu'
  '--hide-scrollbars'
  '--no-first-run'
  '--no-default-browser-check'
  '--disable-extensions'
  '--disable-background-networking'
  '--force-device-scale-factor=1'
  "--user-data-dir=$profileDir"
  "--window-size=$Width,$Height"
  "--virtual-time-budget=$SettleMs"
  "--screenshot=$Out"
)
if (-not $AllowMotion) { $args += '--force-prefers-reduced-motion' }
if ($FullPage) { $args += '--screenshot-full-page' }
$args += $Url

$p = Start-Process -FilePath $chrome -ArgumentList $args -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(60000)) { $p.Kill() }

# Chrome forks renderer/gpu children that survive the parent; without this the
# profile stays locked and the next run silently reuses a stale window size.
Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like "*$profileDir*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (Test-Path $Out) {
  $kb = (Get-Item $Out).Length / 1KB
  "{0}  ({1:N0} KB, {2}x{3})" -f $Out, $kb, $Width, $Height
} else {
  throw "capture failed: $Out"
}
