@echo off
chcp 65001 > nul
setlocal

set ROOT=D:\www\g-daipai
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
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3034" ^| findstr "LISTEN"') do taskkill /PID %%a /F > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3035" ^| findstr "LISTEN"') do taskkill /PID %%a /F > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTEN"') do taskkill /PID %%a /F > nul 2>&1
timeout /t 1 > nul

echo [2/4] Start API Server: http://localhost:3034
start "g-daipai-api" /b cmd /c "cd /d %ROOT% && node src\server\index.js <NUL > server-start.log 2>&1"

echo [3/4] Start Client: http://localhost:3035
start "g-daipai-client" /b cmd /c "cd /d %CLIENT_DIR% && npm run dev -- --host 0.0.0.0 <NUL > %ROOT%\client-start.log 2>&1"

echo [4/4] Start Admin Report: http://localhost:8000/#/login
start "g-daipai-admin" /b cmd /c "cd /d %ADMIN_DIR% && npm start <NUL > %ROOT%\admin-start.log 2>&1"

timeout /t 20 > nul

set API_OK=0
set CLIENT_OK=0
set ADMIN_OK=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3034" ^| findstr "LISTEN"') do set API_OK=1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3035" ^| findstr "LISTEN"') do set CLIENT_OK=1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTEN"') do set ADMIN_OK=1

echo.
if "%API_OK%"=="1" (
  echo API Server OK: http://localhost:3034
) else (
  echo API Server NOT running. Check %ROOT%\server-start.log
)

if "%CLIENT_OK%"=="1" (
  echo Client OK: http://localhost:3035
) else (
  echo Client NOT running. Check %ROOT%\client-start.log
)

if "%ADMIN_OK%"=="1" (
  echo Admin Report OK: http://localhost:8000/#/login
) else (
  echo Admin Report NOT running. Check %ROOT%\admin-start.log
)

echo.
echo.
echo Services are running. Keep this window open.
echo Press Ctrl+C or close this window to stop.
echo.

:keepalive
timeout /t 3600 > nul
goto keepalive
