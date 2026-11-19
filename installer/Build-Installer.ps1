$ErrorActionPreference = 'Stop'
$deps = Join-Path $PSScriptRoot 'generated'
New-Item -ItemType Directory -Path $deps -Force | Out-Null

$platformToolsVersion = 'r36.0.2'
$platformToolsUri = "https://dl.google.com/android/repository/platform-tools_$platformToolsVersion-win.zip"
$platformToolsSha256 = 'b024d4f319d6ad3004de1ba7b96a5c7c5f3512e8b14126308d598b4ab93dcead'
$platformTools = Join-Path $deps 'platform-tools'
$platformToolsStage = Join-Path ([IO.Path]::GetTempPath()) ('easy-adb-platform-tools-' + [guid]::NewGuid().ToString('N'))
$platformToolsZip = Join-Path $platformToolsStage "platform-tools_$platformToolsVersion-win.zip"
New-Item -ItemType Directory -Path $platformToolsStage -Force | Out-Null
try {
    Invoke-WebRequest -Uri $platformToolsUri -OutFile $platformToolsZip
    $actualPlatformToolsSha256 = (Get-FileHash -LiteralPath $platformToolsZip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualPlatformToolsSha256 -ne $platformToolsSha256) {
        throw "Invalid platform-tools SHA256. Expected $platformToolsSha256, got $actualPlatformToolsSha256."
    }
    Expand-Archive -LiteralPath $platformToolsZip -DestinationPath $platformToolsStage -Force
    if (-not (Test-Path -LiteralPath (Join-Path $platformToolsStage 'platform-tools\adb.exe'))) {
        throw 'Downloaded platform-tools archive does not contain platform-tools\adb.exe.'
    }
    New-Item -ItemType Directory -Path $platformTools -Force | Out-Null
    Copy-Item -Path (Join-Path $platformToolsStage 'platform-tools\*') -Destination $platformTools -Recurse -Force
} finally {
    if (Test-Path -LiteralPath $platformToolsStage) {
        Remove-Item -LiteralPath $platformToolsStage -Recurse -Force
    }
}

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
