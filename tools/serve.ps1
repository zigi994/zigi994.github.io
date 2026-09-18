param(
  [int]$Port = 8787,
  [string]$Root = ''
)

$ErrorActionPreference = 'Stop'

# Paths are derived from the script location so they survive the non-ASCII
# parent directory name, which PowerShell 5.1 mangles when reading a BOM-less .ps1.
$RepoRoot = (Get-Item $PSScriptRoot).Parent.FullName
if ($Root -eq '') { $Root = Join-Path $RepoRoot 'zigi994' }
$ToolsRoot = $PSScriptRoot

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.avif' = 'image/avif'
  '.gif'  = 'image/gif'
  '.ico'  = 'image/x-icon'
  '.pdf'  = 'application/pdf'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.otf'  = 'font/otf'
  '.txt'  = 'text/plain; charset=utf-8'
  '.xml'  = 'application/xml; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "site  : http://localhost:$Port/          ($Root)"
Write-Host "tools : http://localhost:$Port/__tools/   ($ToolsRoot)"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }

    # Build sink: the canvas-based pipeline pages stream generated bitmaps back
    # here because this machine has no image toolchain. Names are repo-relative.
    if ($rel -eq '_save' -and $req.HttpMethod -eq 'POST') {
      $name = $req.QueryString['name']
      if ($name -notmatch '^[A-Za-z0-9._/-]+$' -or $name -match '\.\.') {
        $res.StatusCode = 400
      } else {
        $target = Join-Path $RepoRoot $name
        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
        $ms = New-Object System.IO.MemoryStream
        $req.InputStream.CopyTo($ms)
        [System.IO.File]::WriteAllBytes($target, $ms.ToArray())
        Write-Host "saved $name ($($ms.Length) bytes)"
        $res.StatusCode = 200
      }
      $res.Headers.Add('Access-Control-Allow-Origin', '*')
      $res.ContentLength64 = 0
      $res.OutputStream.Close()
      continue
    }

    # Build/QA tooling is mounted outside the deployable site so it never ships.
    if ($rel -eq '__tools' -or $rel.StartsWith('__tools/')) {
      $sub = $rel.Substring([Math]::Min(8, $rel.Length))
      if ($sub -eq '') { $sub = 'index.html' }
      $path = Join-Path $ToolsRoot $sub
    } else {
      $path = Join-Path $Root $rel
    }

    if ((Test-Path $path -PathType Container)) { $path = Join-Path $path 'index.html' }

    if (Test-Path $path -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      $ct = $mime[$ext]
      if (-not $ct) { $ct = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $res.ContentType = $ct
      # Markup and code stay uncached so edits show up on reload; media is
      # cacheable so the service worker behaves like it will in production.
      if ($ext -in @('.html', '.css', '.js', '.mjs', '.json', '.webmanifest')) {
        $res.Headers.Add('Cache-Control', 'no-store')
      } else {
        $res.Headers.Add('Cache-Control', 'public, max-age=3600')
      }
      $res.Headers.Add('Service-Worker-Allowed', '/')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 $rel")
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.ContentLength64 = $body.Length
      $res.OutputStream.Write($body, 0, $body.Length)
    }
    $res.OutputStream.Close()
  } catch {
    Write-Host "err: $($_.Exception.Message)"
  }
}
