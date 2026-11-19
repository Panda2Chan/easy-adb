[Setup]
AppId={{39B22F81-AF84-4486-8406-4F8FFA6FA272}
AppName=Easy ADB
AppVersion=0.2.0
AppPublisher=Panda2Chan
DefaultDirName={localappdata}\Programs\Easy ADB
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
UninstallDisplayIcon={app}\EasyAdb.exe
DisableProgramGroupPage=yes
WizardStyle=modern
LicenseFile=generated\AndroidSdkLicense.txt
OutputDir=..\releases
OutputBaseFilename=EasyADB-Setup-x64
Compression=lzma2/fast
SolidCompression=yes
ArchiveExtraction=full

[Files]
Source: "..\out\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "generated\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy
Source: "generated\platform-tools\*"; DestDir: "{app}\platform-tools"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Easy ADB"; Filename: "{app}\EasyAdb.exe"

[Run]
Filename: "{app}\EasyAdb.exe"; Description: "启动 Easy ADB"; Flags: nowait postinstall skipifsilent

[Code]
function RuntimePresent(): Boolean;
var
  Version: String;
  Key: String;
begin
  Key := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := RegQueryStringValue(HKLM32, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
  if not Result then
    Result := RegQueryStringValue(HKCU, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if not RuntimePresent() then begin
    WizardForm.PreparingLabel.Caption := '正在准备 Microsoft WebView2 界面运行环境…';
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) or not RuntimePresent() then
      Result := '未能安装 Microsoft WebView2。请确认可访问微软下载服务，然后重试。';
  end;
end;
