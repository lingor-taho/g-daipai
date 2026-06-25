@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

title g-daipai database initialization
echo ========================================
echo   g-daipai database initialization
echo   SQLite + admin account
echo ========================================
echo.
echo Project root: %ROOT%
echo.

where /Q node
if errorlevel 1 (
  echo Node.js was not found. Run the environment setup BAT file first.
  goto :fail
)

set "DB_URL=sqlite:./data/gdaipai.db"
if exist "%ROOT%\.env" (
  for /f "tokens=1,* delims==" %%A in ('findstr /B /C:"DATABASE_URL=" "%ROOT%\.env"') do (
    set "DB_URL=%%B"
  )
)

if /I "%DB_URL:~0,7%"=="sqlite:" (
  set "DB_REL=%DB_URL:~7%"
) else (
  echo DATABASE_URL is not sqlite: %DB_URL%
  echo Set DATABASE_URL=sqlite:./data/gdaipai.db in .env and retry.
  goto :fail
)

set "DB_REL=%DB_REL://=%"

if not "%DB_REL:~1,1%"==":" (
  set "DB_PATH=%ROOT%\%DB_REL%"
) else (
  set "DB_PATH=%DB_REL%"
)

for %%p in ("%DB_PATH%") do set "DB_DIR=%%~dp"
if not exist "%DB_DIR%" mkdir "%DB_DIR%" > nul 2>&1

if exist "%DB_PATH%" (
  echo Existing database found: %DB_PATH%
) else (
  echo Database will be created: %DB_PATH%
)

set "ADMIN_USER=admin"
set "ADMIN_PASS=admin123"
set "DB_PATH=%DB_PATH%"

cd /d "%ROOT%"
node scripts/bootstrap-db-admin.js
if errorlevel 1 goto :bootstrap_fail

echo.
echo Done.
echo Admin account: admin / admin123
echo Next step: run "start.bat" to start API, client, and admin.
echo.
pause
exit /b 0

:bootstrap_fail
echo.
echo Database initialization failed.
echo Make sure dependencies are installed: better-sqlite3 and bcryptjs.
echo Run "??????.bat" first, then retry.
echo.
pause
exit /b 1

:fail
echo.
echo Database initialization failed. Read the message above, fix it, then run again.
echo.
pause
exit /b 1
