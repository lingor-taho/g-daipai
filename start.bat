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

echo [1/4] Stop old services on ports 3000, 3001 and 8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTEN"') do taskkill /PID %%a /F > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTEN"') do taskkill /PID %%a /F > nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTEN"') do taskkill /PID %%a /F > nul 2>&1
timeout /t 1 > nul

echo [2/4] Start API Server: http://localhost:3000
start "g-daipai-api" /b cmd /c "cd /d %ROOT% && node src\server\index.js"

echo [3/4] Start Client: http://localhost:3001
start "g-daipai-client" /b cmd /c "cd /d %CLIENT_DIR% && npm run dev -- --host 0.0.0.0"

echo [4/4] Start Admin Report: http://localhost:8000/#/login
start "g-daipai-admin" /b cmd /c "cd /d %ADMIN_DIR% && npm start -- --host 0.0.0.0"

timeout /t 5 > nul

set API_OK=0
set CLIENT_OK=0
set ADMIN_OK=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTEN"') do set API_OK=1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTEN"') do set CLIENT_OK=1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTEN"') do set ADMIN_OK=1

echo.
if "%API_OK%"=="1" (
  echo API Server OK: http://localhost:3000
) else (
  echo API Server NOT running. Check messages above.
)

if "%CLIENT_OK%"=="1" (
  echo Client OK: http://localhost:3001
) else (
  echo Client NOT running. Check messages above.
)

if "%ADMIN_OK%"=="1" (
  echo Admin Report OK: http://localhost:8000/#/login
) else (
  echo Admin Report NOT running. Check messages above.
)

echo.
echo.
echo Services are running. Keep this window open.
echo Press Ctrl+C or close this window to stop.
echo.

:keepalive
timeout /t 3600 > nul
goto keepalive
