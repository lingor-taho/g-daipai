@echo off
chcp 65001 > nul
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set CLIENT_DIR=%ROOT%\src\client
set ADMIN_DIR=%ROOT%\src\admin

title g-daipai services

echo ========================================
echo   g-daipai services
echo ========================================
echo.
echo This window owns the services.
echo Close this window to stop API Server and Client.
echo.

echo [1/4] Stop old services on ports 3034, 3035 and 8000...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*scripts\api-watch.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3034" ^| findstr "LISTEN"') do taskkill /PID %%a /F > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3035" ^| findstr "LISTEN"') do taskkill /PID %%a /F > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTEN"') do taskkill /PID %%a /F > nul 2>&1
timeout /t 1 > nul

echo [2/4] Start API Server: http://localhost:3034
type nul > "%ROOT%\server-start.log"
type nul > "%ROOT%\server-start.err.log"
start "g-daipai-api-watch" /b cmd /c ""%ROOT%\scripts\api-watch.bat" "%ROOT%""

echo [3/4] Check build and start Client: http://localhost:3035
type nul > "%ROOT%\client-build.log"
type nul > "%ROOT%\client-start.log"
node "%ROOT%\scripts\build-if-needed.js" client > "%ROOT%\client-build.log" 2>&1
if errorlevel 1 (
  echo Client build failed. Trying to serve the existing dist directory.
  echo Check %ROOT%\client-build.log
)
type "%ROOT%\client-build.log"
start "g-daipai-client" /b cmd /c "cd /d %ROOT% && node scripts\serve-client-dist.js <NUL > %ROOT%\client-start.log 2>&1"

echo [4/4] Check build and start Admin Report: http://localhost:8000/#/login
type nul > "%ROOT%\admin-start.log"
echo       Unchanged builds will be reused. Build progress is shown when needed.
node "%ROOT%\scripts\build-if-needed.js" admin
if errorlevel 1 (
  echo Admin build failed. Trying to serve the existing dist directory.
) else (
  echo Admin static files ready. Starting static report service...
)
start "g-daipai-admin" /b cmd /c "cd /d %ROOT% && set STATIC_DIST_DIR=%ADMIN_DIR%\dist&& set STATIC_PORT=8000&& set STATIC_SERVER_NAME=Admin&& node scripts\serve-client-dist.js <NUL > %ROOT%\admin-start.log 2>&1"

echo Checking service readiness (returns immediately when ready; maximum 20 seconds)...
node "%ROOT%\scripts\wait-for-services.js"
if errorlevel 1 (
  echo Some services are NOT ready. Check the logs listed above.
) else (
  echo Services are running.
)
echo Keep this window open.
echo Press Ctrl+C or close this window to stop.
echo.

:keepalive
timeout /t 3600 > nul
goto keepalive
