@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "BACKUP_DIR=%ROOT%\backups"

echo.
echo [g-daipai] Restore script
echo Project: %ROOT%
echo Backup folder: %BACKUP_DIR%
echo.
echo Before continuing, close API Server, frontend/admin dev servers, and Chrome windows used by the plugin.
echo Restore will overwrite current source code, config files, database, plugin files, and docs.
echo Restore will not delete backups, .git, node_modules, or dist folders.
echo A before-restore backup of the current state will be created first.
echo.

if not exist "%BACKUP_DIR%" (
  echo Backup folder not found: %BACKUP_DIR%
  pause
  exit /b 1
)

set /A COUNT=0
echo Available backups:
for /f "delims=" %%F in ('dir /B /O-D "%BACKUP_DIR%\g-daipai-backup-*.zip" 2^>nul') do (
  set /A COUNT+=1
  set "BACKUP_!COUNT!=%%F"
  echo   !COUNT!. %%F
)

if "%COUNT%"=="0" (
  echo.
  echo No g-daipai-backup-*.zip files found.
  pause
  exit /b 1
)

echo.
set /P CHOICE_NUM="Enter backup number to restore: "
if not defined BACKUP_%CHOICE_NUM% (
  echo Invalid number.
  pause
  exit /b 1
)

set "SELECTED=!BACKUP_%CHOICE_NUM%!"
set "SELECTED_ZIP=%BACKUP_DIR%\%SELECTED%"

echo.
echo Selected backup:
echo %SELECTED_ZIP%
echo.
choice /C YN /M "Restore this backup?"
if errorlevel 2 (
  echo Restore cancelled.
  pause
  exit /b 1
)

for /f %%I in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%I"
set "SAFE_NAME=g-daipai-before-restore-%STAMP%"
set "SAFE_STAGE=%BACKUP_DIR%\_before_restore_stage_%STAMP%"
set "SAFE_ZIP=%BACKUP_DIR%\%SAFE_NAME%.zip"
set "RESTORE_STAGE=%BACKUP_DIR%\_restore_stage_%STAMP%"

if exist "%SAFE_STAGE%" rmdir /S /Q "%SAFE_STAGE%"
if exist "%RESTORE_STAGE%" rmdir /S /Q "%RESTORE_STAGE%"
mkdir "%SAFE_STAGE%"
mkdir "%RESTORE_STAGE%"

echo.
echo Creating before-restore backup...
robocopy "%ROOT%" "%SAFE_STAGE%" /MIR ^
  /XD "%BACKUP_DIR%" "%ROOT%\.git" "%ROOT%\node_modules" "%ROOT%\src\client\node_modules" "%ROOT%\src\admin\node_modules" "%ROOT%\src\client\dist" "%ROOT%\src\admin\dist" ^
  /XF "*.log" "*.tmp" >nul

set "ROBOCOPY_EXIT=%ERRORLEVEL%"
if %ROBOCOPY_EXIT% GEQ 8 (
  echo.
  echo Before-restore backup failed. Restore stopped. robocopy exit code: %ROBOCOPY_EXIT%
  if exist "%SAFE_STAGE%" rmdir /S /Q "%SAFE_STAGE%"
  if exist "%RESTORE_STAGE%" rmdir /S /Q "%RESTORE_STAGE%"
  pause
  exit /b %ROBOCOPY_EXIT%
)

(
  echo Backup name: %SAFE_NAME%
  echo Created at: %DATE% %TIME%
  echo Source: %ROOT%
  echo Reason: automatic safety backup before restore
) > "%SAFE_STAGE%\BACKUP_INFO.txt"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%SAFE_STAGE%\*' -DestinationPath '%SAFE_ZIP%' -CompressionLevel Optimal -Force"
if errorlevel 1 (
  echo.
  echo Before-restore zip creation failed. Restore stopped.
  if exist "%SAFE_STAGE%" rmdir /S /Q "%SAFE_STAGE%"
  if exist "%RESTORE_STAGE%" rmdir /S /Q "%RESTORE_STAGE%"
  pause
  exit /b 1
)
rmdir /S /Q "%SAFE_STAGE%"

echo.
echo Extracting selected backup...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%SELECTED_ZIP%' -DestinationPath '%RESTORE_STAGE%' -Force"
if errorlevel 1 (
  echo.
  echo Extract failed. Restore stopped.
  if exist "%RESTORE_STAGE%" rmdir /S /Q "%RESTORE_STAGE%"
  pause
  exit /b 1
)

echo.
echo Restoring files...
robocopy "%RESTORE_STAGE%" "%ROOT%" /MIR ^
  /XD "%BACKUP_DIR%" "%ROOT%\.git" "%ROOT%\node_modules" "%ROOT%\src\client\node_modules" "%ROOT%\src\admin\node_modules" "%ROOT%\src\client\dist" "%ROOT%\src\admin\dist" >nul

set "ROBOCOPY_EXIT=%ERRORLEVEL%"
if %ROBOCOPY_EXIT% GEQ 8 (
  echo.
  echo Restore copy failed. robocopy exit code: %ROBOCOPY_EXIT%
  echo Current-state safety backup:
  echo %SAFE_ZIP%
  if exist "%RESTORE_STAGE%" rmdir /S /Q "%RESTORE_STAGE%"
  pause
  exit /b %ROBOCOPY_EXIT%
)

rmdir /S /Q "%RESTORE_STAGE%"

echo.
echo RESTORE COMPLETED.
echo Restored backup:
echo %SELECTED_ZIP%
echo.
echo Current-state safety backup:
echo %SAFE_ZIP%
echo.
pause
exit /b 0
