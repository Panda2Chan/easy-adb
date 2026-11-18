#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $Destination
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$version = '36.0.2'
$uri = "https://dl.google.com/android/repository/platform-tools_r${version}-win.zip"
$expectedHash = 'b024d4f319d6ad3004de1ba7b96a5c7c5f3512e8b14126308d598b4ab93dcead'
$work = $null

try {
    $path = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination)
    $target = [System.IO.DirectoryInfo]::new($path)
    if (Test-Path -LiteralPath $target.FullName) {
        throw "Destination already exists: $($target.FullName)"
    }

    $parent = [System.IO.Directory]::CreateDirectory($target.Parent.FullName).FullName
    $work = New-Item -ItemType Directory -Path $parent -Name ('.platform-tools-' + [guid]::NewGuid().ToString('N'))
    $archive = Join-Path $work.FullName 'download.zip'
    $payload = Join-Path $work.FullName 'payload'

    if ($PSVersionTable.PSEdition -eq 'Desktop') {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    }
    Invoke-WebRequest -Uri $uri -UseBasicParsing -OutFile $archive -MaximumRedirection 0 -TimeoutSec 120
    $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) {
        throw "SHA256 mismatch for platform-tools $version. Expected $expectedHash, got $actualHash."
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $payload)
    # 同卷移动完整目录；若其他进程已创建目标，则失败并保留对方的目录。
    [System.IO.Directory]::Move($payload, $target.FullName)
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
finally {
    if ($null -ne $work) {
        Remove-Item -LiteralPath $work.FullName -Recurse -Force
    }
}
exit 0
