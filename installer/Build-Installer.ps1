$ErrorActionPreference = 'Stop'
$deps = Join-Path $PSScriptRoot 'generated'
New-Item -ItemType Directory -Path $deps -Force | Out-Null
$bootstrap = Join-Path $deps 'MicrosoftEdgeWebview2Setup.exe'
Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrap
$signature = Get-AuthenticodeSignature $bootstrap
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo('SimpleName', $false) -ne 'Microsoft Corporation') {
    throw 'Invalid Microsoft WebView2 bootstrapper signature.'
}
$metadata = Join-Path $deps 'repository.xml'
Invoke-WebRequest 'https://dl.google.com/android/repository/repository2-1.xml' -OutFile $metadata
[xml]$sdk = Get-Content -LiteralPath $metadata -Raw -Encoding utf8
$license = $sdk.SelectSingleNode("//*[local-name()='license' and @id='android-sdk-license']")
if (-not $license -or $license.InnerText -notmatch 'Software Development Kit License Agreement') { throw 'Missing Android SDK license.' }
Set-Content -LiteralPath (Join-Path $deps 'AndroidSdkLicense.txt') -Value $license.InnerText -Encoding utf8BOM
$compiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'
if (-not (Test-Path $compiler)) { $compiler = (Get-Command ISCC.exe -ErrorAction Stop).Source }
& $compiler (Join-Path $PSScriptRoot 'EasyAdb.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC exited with $LASTEXITCODE" }
