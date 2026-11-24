param([Parameter(Mandatory)] [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$destination = (New-Item -ItemType Directory -Force -Path $OutputDirectory).FullName
$tools = Get-ChildItem -Directory (Join-Path $env:ANDROID_HOME 'build-tools') | Where-Object { $_.Name -as [version] } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (!$tools) { throw 'Android SDK Build-Tools required.' }
Copy-Item (Join-Path $tools.FullName 'aapt2.exe') $destination
Copy-Item (Join-Path $tools.FullName 'NOTICE.txt') $destination
Push-Location (Join-Path $PSScriptRoot '../package-tools')
try {
    $env:AAPT2_PATH = Join-Path $destination 'aapt2.exe'
    go test ./...
    if ($LASTEXITCODE) { throw 'Package tests failed' }
    go build -trimpath -o (Join-Path $destination 'preflight.exe') .
    if ($LASTEXITCODE) { throw 'Package build failed' }
} finally { Pop-Location }
