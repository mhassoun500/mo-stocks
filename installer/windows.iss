; Windows installer for Mo Stocks (Inno Setup 6)
#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif

[Setup]
AppId={{8C4C2E0B-5B7E-4E7A-9C7B-3F2A1D6E9B11}
AppName=Mo Stocks
AppVersion={#AppVersion}
AppVerName=Mo Stocks {#AppVersion}
AppPublisher=Mohamed Hassoun
DefaultDirName={autopf}\Mo Stocks
DefaultGroupName=Mo Stocks
DisableProgramGroupPage=yes
OutputDir=..\dist-installer
OutputBaseFilename=MoStocks_Setup_v{#AppVersion}
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\MoStocks.exe
UninstallDisplayName=Mo Stocks
UsePreviousAppDir=no
UsePreviousGroup=no
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\MoStocks\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Mo Stocks"; Filename: "{app}\MoStocks.exe"
Name: "{autodesktop}\Mo Stocks"; Filename: "{app}\MoStocks.exe"; Tasks: desktopicon

[InstallDelete]
; the program was called "Stock Zones" before version 2.4: remove its old copy and shortcuts
Type: filesandordirs; Name: "{autopf}\Stock Zones"
Type: filesandordirs; Name: "{userpf}\Stock Zones"
Type: filesandordirs; Name: "{group}\..\Stock Zones"
Type: files; Name: "{autodesktop}\محلل مناطق الأسهم.lnk"
Type: files; Name: "{userdesktop}\محلل مناطق الأسهم.lnk"
Type: files; Name: "{commondesktop}\محلل مناطق الأسهم.lnk"

[Run]
Filename: "{app}\MoStocks.exe"; Description: "{cm:LaunchProgram,Mo Stocks}"; Flags: nowait postinstall skipifsilent
