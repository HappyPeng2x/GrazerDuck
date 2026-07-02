#Requires -Version 5.1
<#
.SYNOPSIS
    Serves GrazerDuck locally so it can be installed as a PWA.
.DESCRIPTION
    Starts a local HTTP server and opens your browser. Install the app once,
    then close this window — GrazerDuck runs fully offline from then on.
.PARAMETER Port
    TCP port to listen on (default 8765).
.EXAMPLE
    .\Serve.ps1
.EXAMPLE
    .\Serve.ps1 -Port 9000
#>
param([int]$Port = 8765)

$Root      = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$CanonRoot = [IO.Path]::GetFullPath($Root) + [IO.Path]::DirectorySeparatorChar

$Mime = @{
    '.html'        = 'text/html; charset=utf-8'
    '.js'          = 'application/javascript'
    '.mjs'         = 'application/javascript'
    '.css'         = 'text/css'
    '.wasm'        = 'application/wasm'
    '.json'        = 'application/json'
    '.webmanifest' = 'application/manifest+json'
    '.png'         = 'image/png'
    '.svg'         = 'image/svg+xml'
    '.ico'         = 'image/x-icon'
    '.ttf'         = 'font/ttf'
    '.woff'        = 'font/woff'
    '.woff2'       = 'font/woff2'
}

Write-Host ''
Write-Host ' GrazerDuck ' -ForegroundColor Black -BackgroundColor DarkYellow
Write-Host ''
Write-Host "  URL    http://localhost:$Port" -ForegroundColor Cyan
Write-Host ''
Write-Host '  1. Your browser will open automatically.'
Write-Host '  2. Wait for DuckDB to load (a few seconds on first run).'
Write-Host '  3. Click [+ Install App] in the browser toolbar.'
Write-Host '  4. Once installed, close this window.'
Write-Host '     The app runs fully offline from then on.'
Write-Host ''
Write-Host '  Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host '  --------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''

$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://localhost:$Port/")

try {
    $Listener.Start()
} catch [System.Net.HttpListenerException] {
    Write-Host "  ERROR: Port $Port is already in use." -ForegroundColor Red
    Write-Host "  Try:   .\Serve.ps1 -Port 9000" -ForegroundColor DarkGray
    exit 1
}

Start-Process "http://localhost:$Port"

try {
    while ($Listener.IsListening) {
        $Ctx = $Listener.GetContext()
        $Req = $Ctx.Request
        $Res = $Ctx.Response

        # COOP + COEP give crossOriginIsolated = true so DuckDB picks its
        # fastest (multi-threaded) WASM bundle immediately, without a reload.
        $Res.Headers.Add('Cross-Origin-Opener-Policy',   'same-origin')
        $Res.Headers.Add('Cross-Origin-Embedder-Policy', 'require-corp')

        $UrlPath = $Req.Url.LocalPath
        if ($UrlPath -eq '/' -or $UrlPath -eq '') { $UrlPath = '/index.html' }

        $Rel      = $UrlPath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
        $FilePath = [IO.Path]::GetFullPath((Join-Path $Root $Rel))

        if (-not $FilePath.StartsWith($CanonRoot)) {
            $Res.StatusCode = 403
            Write-Host "  403  $UrlPath" -ForegroundColor Red
        } elseif (Test-Path $FilePath -PathType Leaf) {
            $Ext             = [IO.Path]::GetExtension($FilePath).ToLower()
            $Res.ContentType = if ($Mime.ContainsKey($Ext)) { $Mime[$Ext] } else { 'application/octet-stream' }
            $Bytes           = [IO.File]::ReadAllBytes($FilePath)
            $Res.ContentLength64 = $Bytes.Length
            $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
            Write-Host "  200  $UrlPath" -ForegroundColor DarkGray
        } else {
            # SPA fallback — unknown paths serve index.html
            $Bytes           = [IO.File]::ReadAllBytes((Join-Path $Root 'index.html'))
            $Res.ContentType = 'text/html; charset=utf-8'
            $Res.ContentLength64 = $Bytes.Length
            $Res.OutputStream.Write($Bytes, 0, $Bytes.Length)
            Write-Host "  200  $UrlPath  (index.html)" -ForegroundColor DarkGray
        }

        $Res.OutputStream.Close()
    }
} finally {
    $Listener.Stop()
    $Listener.Close()
    Write-Host ''
    Write-Host '  Server stopped.' -ForegroundColor DarkGray
}
