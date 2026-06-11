@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "BACKUP_DIR=%ROOT%\backups"

echo.
echo [g-daipai] Backup script
echo Project: %ROOT%
echo Backup folder: %BACKUP_DIR%
echo.
echo Before continuing, close API Server, frontend/admin dev servers, and Chrome windows used by the plugin.
echo This backup includes source code, config files, database, plugin files, and docs.
echo Excluded folders: backups, .git, node_modules, dist.
echo Excluded files: *.log, *.tmp.
echo.
choice /C YN /M "Start backup now?"
if errorlevel 2 (
  echo Backup cancelled.
  pause
  exit /b 1
)

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

for /f %%I in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%I"
set "NAME=g-daipai-backup-%STAMP%"
set "STAGE=%BACKUP_DIR%\_stage_%STAMP%"
set "ZIP=%BACKUP_DIR%\%NAME%.zip"

if exist "%STAGE%" rmdir /S /Q "%STAGE%"
mkdir "%STAGE%"

echo.
echo Copying files to staging folder...
robocopy "%ROOT%" "%STAGE%" /MIR ^
  /XD "%BACKUP_DIR%" "%ROOT%\.git" "%ROOT%\node_modules" "%ROOT%\src\client\node_modules" "%ROOT%\src\admin\node_modules" "%ROOT%\src\client\dist" "%ROOT%\src\admin\dist" ^
  /XF "*.log" "*.tmp" >nul

set "ROBOCOPY_EXIT=%ERRORLEVEL%"
if %ROBOCOPY_EXIT% GEQ 8 (
  echo.
  echo File copy failed. robocopy exit code: %ROBOCOPY_EXIT%
  if exist "%STAGE%" rmdir /S /Q "%STAGE%"
  pause
  exit /b %ROBOCOPY_EXIT%
)

(
  echo Backup name: %NAME%
  echo Created at: %DATE% %TIME%
  echo Source: %ROOT%
  echo Excluded: backups, .git, node_modules, dist, log files
) > "%STAGE%\BACKUP_INFO.txt"

where git >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  pushd "%ROOT%" >nul
  git rev-parse HEAD > "%STAGE%\BACKUP_GIT_HEAD.txt" 2>nul
  git status --short > "%STAGE%\BACKUP_GIT_STATUS.txt" 2>nul
  popd >nul
)

echo.
echo Creating zip archive...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%ZIP%' -CompressionLevel Optimal -Force"
if errorlevel 1 (
  echo.
  echo Zip creation failed.
  if exist "%STAGE%" rmdir /S /Q "%STAGE%"
  pause
  exit /b 1
)

rmdir /S /Q "%STAGE%"

echo.
echo BACKUP COMPLETED.
echo Backup file:
echo %ZIP%
echo.
pause
exit /b 0
