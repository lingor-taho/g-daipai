@echo off
chcp 65001 >nul
setlocal EnableExtensions

if not defined GDAIPAI_THREE_TABLE_CLEANUP_KEEP_OPEN (
  set "GDAIPAI_THREE_TABLE_CLEANUP_KEEP_OPEN=1"
  start "g-daipai three-table cleanup" cmd /k ""%~f0" %*"
  exit /b
)

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

title g-daipai three-table cleanup
cd /d "%ROOT%"

where /Q node
if errorlevel 1 (
  echo Node.js was not found.
  exit /b 1
)

if not exist "%ROOT%\scripts\three-table-cleanup.js" (
  echo Missing script: %ROOT%\scripts\three-table-cleanup.js
  exit /b 1
)

node scripts\three-table-cleanup.js
set "EXIT_CODE=%ERRORLEVEL%"
exit /b %EXIT_CODE%
