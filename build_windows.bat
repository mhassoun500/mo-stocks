@echo off
REM Builds the Windows app, then the installer (Inno Setup 6) or a portable zip if Inno Setup is unavailable.
setlocal
cd /d "%~dp0"
set /p VER=<VERSION

where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")
%PY% -m pip install --upgrade -r requirements.txt pyinstaller || goto :err
%PY% tools\build_page.py || goto :err
%PY% -m PyInstaller --noconfirm --clean --windowed --name MoStocks --icon assets\icon.ico ^
  --add-data "app\page.html;." --add-data "app\fonts;fonts" --add-data "assets\icon.png;." --add-data "VERSION;." app\main.py || goto :err
echo.
echo App built: dist\MoStocks\MoStocks.exe

call :find_iscc
if not defined ISCC (
  echo Inno Setup 6 not found. Trying to install it with winget...
  winget install --id JRSoftware.InnoSetup -e --silent --accept-package-agreements --accept-source-agreements >nul 2>nul
  call :find_iscc
)
if defined ISCC (
  "%ISCC%" /DAppVersion=%VER% installer\windows.iss || goto :err
  echo.
  echo Installer ready: dist-installer\MoStocks_Setup_v%VER%.exe
) else (
  if not exist dist-installer mkdir dist-installer
  powershell -NoProfile -Command "Compress-Archive -Path 'dist\MoStocks\*' -DestinationPath 'dist-installer\MoStocks_v%VER%_portable.zip' -Force" || goto :err
  echo.
  echo Inno Setup is not installed, so a portable version was made instead:
  echo   dist-installer\MoStocks_v%VER%_portable.zip
  echo Unzip it anywhere and run MoStocks.exe. For a real installer, install Inno Setup 6
  echo from https://jrsoftware.org/isdl.php and run this file again.
)
pause
exit /b 0

:find_iscc
set "ISCC="
for %%P in ("%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" "%ProgramFiles%\Inno Setup 6\ISCC.exe" "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe") do (
  if exist %%P set "ISCC=%%~P"
)
if not defined ISCC for /f "delims=" %%I in ('where ISCC.exe 2^>nul') do set "ISCC=%%I"
exit /b 0

:err
echo Build failed.
pause
exit /b 1
