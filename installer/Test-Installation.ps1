#requires -Version 7.2
<#
.SYNOPSIS
Smoke-test the actual setup on a clean Windows runner with a desktop session.
.EXAMPLE
pwsh -NoProfile -File .\installer\Test-Installation.ps1 -Installer 'C:\artifacts\EasyADB-Setup-x64.exe'
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This test requires a Windows desktop runner.' }
if (-not [IO.Path]::IsPathFullyQualified($Installer) -or
    [IO.Path]::GetExtension($Installer) -ne '.exe' -or -not [IO.File]::Exists($Installer)) {
    throw "Expected the full path of an existing installer exe: $Installer"
}

$run = Join-Path ([IO.Path]::GetTempPath()) ('easy-adb-smoke-' + [guid]::NewGuid().ToString('N'))
$app = Join-Path $run 'Easy ADB'
$profileDir = Join-Path $run 'WebView2'
$adb = Join-Path $app 'platform-tools\adb.exe'
$innoFlags = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
$registration = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{39B22F81-AF84-4486-8406-4F8FFA6FA272}_is1'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Easy ADB.lnk'
if ((Test-Path -LiteralPath $registration) -or (Test-Path -LiteralPath $shortcut)) {
    throw 'An Easy ADB installation already exists for this user. Use a clean runner.'
}
[void][IO.Directory]::CreateDirectory($run)
Write-Host "Installation smoke logs: $run"

function Start-Child([string]$File, [string[]]$Arguments, [string]$Directory, [switch]$Isolated, [switch]$Capture) {
    $info = [Diagnostics.ProcessStartInfo]::new($File)
    $info.WorkingDirectory = $Directory
    $info.UseShellExecute = $false
    foreach ($argValue in $Arguments) { $info.ArgumentList.Add($argValue) }
    if ($Isolated) {
        # 子进程只继承 Windows 系统路径，GUI 自动刷新的 adb 也连接本次测试端口。
        $info.Environment['PATH'] = "$env:SystemRoot\System32;$env:SystemRoot"
        foreach ($key in @($info.Environment.Keys)) {
            if ($key -match '^(ADB_|ANDROID_|WEBVIEW2_)') { [void]$info.Environment.Remove($key) }
        }
        $info.Environment['ADB_SERVER_SOCKET'] = $socket
        $info.Environment['ANDROID_USER_HOME'] = Join-Path $run 'android'
        $info.Environment['WEBVIEW2_USER_DATA_FOLDER'] = $profileDir
        $info.Environment['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=0'
    }
    $info.RedirectStandardOutput = $Capture.IsPresent
    $info.RedirectStandardError = $Capture.IsPresent
    return [Diagnostics.Process]::Start($info)
}

function Wait-Child($Process, [int]$Seconds, [string]$Stage) {
    if (-not $Process.WaitForExit($Seconds * 1000)) {
        $Process.Kill($true)
        throw "$Stage timed out after $Seconds seconds."
    }
    if ($Process.ExitCode -ne 0) { throw "$Stage exited with code $($Process.ExitCode)." }
}

function Wait-Interface($Gui) {
    # 由独立 WebView2 profile 获取实际调试端口。页面标题来自安装后的 index.html。
    $portFiles = @((Join-Path $profileDir 'EBWebView\DevToolsActivePort'), (Join-Path $profileDir 'DevToolsActivePort'))
    $deadline = [datetime]::UtcNow.AddSeconds(60)
    $observed = 'Waiting for the application window and DevToolsActivePort.'
    while ([datetime]::UtcNow -lt $deadline) {
        $Gui.Refresh()
        if ($Gui.HasExited) { throw "GUI exited before WebView2 was ready (code $($Gui.ExitCode))." }
        $portFile = $portFiles | Where-Object { [IO.File]::Exists($_) } | Select-Object -First 1
        if ($Gui.MainWindowHandle -ne [IntPtr]::Zero -and $portFile) {
            try {
                $debugPort = [int]([IO.File]::ReadAllLines($portFile)[0])
                $pages = Invoke-RestMethod "http://127.0.0.1:$debugPort/json/list" -NoProxy -TimeoutSec 3
                $observed = ($pages | Select-Object -Property @('type', 'url', 'title') | ConvertTo-Json -Compress)
                foreach ($page in $pages) {
                    if ($page.type -eq 'page' -and $page.url -eq 'https://easy-adb.invalid/index.html' -and
                        $page.title -like 'Easy ADB*' -and $Gui.Responding) {
                        Write-Host "GUI PID $($Gui.Id), WebView2 loaded $($page.url) [$($page.title)]"
                        return
                    }
                }
            } catch { $observed = $_.Exception.Message }
        }
        Start-Sleep -Milliseconds 300
    }
    throw "WebView2 readiness timed out. Window='$($Gui.MainWindowTitle)' Last observation: $observed"
}

$gui = $server = $null
$errorsFound = [Collections.Generic.List[string]]::new()
try {
    $setup = Start-Child $Installer ($innoFlags + "/DIR=$app" + "/LOG=$run\install.log") $run
    Wait-Child $setup 420 'Setup'
    foreach ($relative in 'EasyAdb.exe','wwwroot\index.html','platform-tools\adb.exe',
            'platform-tools\AdbWinApi.dll','platform-tools\AdbWinUsbApi.dll') {
        $file = Join-Path $app $relative
        if (-not [IO.File]::Exists($file) -or (Get-Item -LiteralPath $file).Length -eq 0) {
            throw "Missing or empty installed file: $file"
        }
    }
    foreach ($filter in '*.js','*.css') {
        if (-not (Get-ChildItem -LiteralPath (Join-Path $app 'wwwroot\assets') -File -Filter $filter |
                Where-Object Length -gt 0)) { throw "Missing frontend asset: $filter" }
    }
    if (-not (Test-Path -LiteralPath $registration)) { throw 'Missing Inno uninstall registration.' }

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $port = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
    $socket = "tcp:$port"
    Write-Host "Private adb server: $socket"
    $server = Start-Child $adb @('-L', $socket, 'server', 'nodaemon') $app -Isolated
    # 确认监听者是刚启动的前台 adb，避免端口竞争导致误用其他服务。
    $deadline = [datetime]::UtcNow.AddSeconds(20)
    do {
        if ($server.HasExited) { throw "Private adb server exited with code $($server.ExitCode)." }
        $bound = Get-NetTCPConnection -LocalPort $port -State Listen -OwningProcess $server.Id -ErrorAction SilentlyContinue
        if ($bound) { break }
        Start-Sleep -Milliseconds 200
    } while ([datetime]::UtcNow -lt $deadline)
    if (-not $bound) { throw "Private adb PID $($server.Id) did not listen on $socket." }

    $client = Start-Child $adb @('devices', '-l') $app -Isolated -Capture
    $stdout = $client.StandardOutput.ReadToEndAsync()
    $stderr = $client.StandardError.ReadToEndAsync()
    try { Wait-Child $client 20 'adb devices -l' } finally {
        [IO.File]::WriteAllText("$run\adb.log", $stdout.GetAwaiter().GetResult() + "`r`n" + $stderr.GetAwaiter().GetResult())
    }
    if ($stdout.Result -notmatch '(?m)^List of devices attached\s*$') { throw 'Unexpected adb devices -l output.' }
    $gui = Start-Child (Join-Path $app 'EasyAdb.exe') @() $app -Isolated
    Wait-Interface $gui
} catch {
    $errorsFound.Add($_.ToString())
} finally {
    foreach ($child in @($gui, $server)) {
        try {
            if ($null -ne $child -and -not $child.HasExited) {
                if ($child -eq $gui) { [void]$child.CloseMainWindow(); [void]$child.WaitForExit(5000) }
                if (-not $child.HasExited) { $child.Kill($true); [void]$child.WaitForExit(5000) }
            }
        } catch { $errorsFound.Add("Stopping test process: $_") }
    }
    try {
        $uninstaller = Join-Path $app 'unins000.exe'
        if ([IO.File]::Exists($uninstaller)) {
            $uninstall = Start-Child $uninstaller ($innoFlags + "/LOG=$run\uninstall.log") $run
            Wait-Child $uninstall 90 'Uninstall'
        } elseif ([IO.Directory]::Exists($app)) { throw "Missing $uninstaller" }
        # Inno 的临时卸载进程可能晚于启动进程退出。
        $deadline = [datetime]::UtcNow.AddSeconds(20)
        do {
            $left = @($app, $registration, $shortcut | Where-Object { Test-Path -LiteralPath $_ })
            if (-not $left.Count) { break }
            Start-Sleep -Milliseconds 250
        } while ([datetime]::UtcNow -lt $deadline)
        if ($left.Count) { throw "Uninstall left behind: $($left -join ', ')" }
    } catch { $errorsFound.Add("Uninstall check: $_") }
}

if ($errorsFound.Count) {
    foreach ($log in 'install.log','adb.log','uninstall.log') {
        $path = Join-Path $run $log
        if ([IO.File]::Exists($path)) { Write-Host "--- $log ---"; Get-Content -LiteralPath $path -Tail 25 | Out-Host }
    }
    throw "Installation smoke failed. Logs: $run`n$($errorsFound -join "`n")"
}
Write-Host 'PASS: install, packaged files, isolated adb, GUI/WebView2 and uninstall.'
