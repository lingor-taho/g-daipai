@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

title g-daipai environment setup
echo ========================================
echo   g-daipai environment setup
echo ========================================
echo.
echo Project root: %ROOT%
echo.

where /Q winget
set "HAS_WINGET=0"
if not errorlevel 1 set "HAS_WINGET=1"

echo [1/6] Check Git
where /Q git
if errorlevel 1 (
  if "%HAS_WINGET%"=="0" (
    echo Git was not found, and winget is not available.
    goto :fail
  )
  echo Git was not found. Installing with winget...
  winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements
  where /Q git
  if errorlevel 1 (
    echo Git install failed. Check network or winget source settings.
    goto :fail
  )
) else (
  echo Git found.
)

echo.
echo [2/6] Check Node.js
where /Q node
if errorlevel 1 (
  if "%HAS_WINGET%"=="0" (
    echo Node.js was not found, and winget is not available.
    goto :fail
  )
  echo Node.js was not found. Installing with winget...
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  where /Q node
  if errorlevel 1 (
    echo Node.js install failed. Check network or winget source settings.
    goto :fail
  )
) else (
  echo Node.js found.
)

echo.
echo [3/6] Check project directory
if not exist "%ROOT%\package.json" (
  echo This is not the project root: %ROOT%
  goto :fail
)

cd /d "%ROOT%"

echo.
echo [4/6] Pull latest code
if not exist "%ROOT%\.git" (
  echo This directory is not a Git repository. Skip git pull.
) else (
  where /Q git
  if errorlevel 1 (
    echo Git command is not available. Skip git pull.
  ) else (
    git remote get-url origin > nul 2>&1
    if errorlevel 0 (
      git fetch --all --prune
      git pull
      if errorlevel 1 (
        echo git pull failed. Check network, branch status, or local changes.
        goto :fail
      )
    ) else (
      echo No origin remote configured. Skip git pull.
    )
  )
)

echo.
echo [5/6] Prepare .env
if not exist "%ROOT%\.env" (
  if exist "%ROOT%\.env.example" (
    copy /Y "%ROOT%\.env.example" "%ROOT%\.env" > nul
    echo Created .env from .env.example.
  ) else (
    echo .env was not found and .env.example is missing.
    goto :fail
  )
) else (
  echo .env found.
)

echo.
echo [6/6] Install dependencies
cd /d "%ROOT%"
echo Installing root dependencies...
call npm install
if errorlevel 1 goto :fail

if exist "%ROOT%\src\client\package.json" (
  echo.
  echo Installing client dependencies...
  cd /d "%ROOT%\src\client"
  call npm install
  if errorlevel 1 goto :fail
)

if exist "%ROOT%\src\admin\package.json" (
  echo.
  echo Installing admin dependencies...
  cd /d "%ROOT%\src\admin"
  call npm install
  if errorlevel 1 goto :fail
)

echo.
echo Done.
node -v
call npm -v
echo.
echo Note:
echo - This script installs Git, Node.js, and npm dependencies.
echo - It does not create the SQLite database.
echo - For a new machine, run the database initialization BAT file after this script.
echo.
pause
exit /b 0

:fail
echo.
echo Environment setup failed. Read the message above, fix it, then run again.
echo.
pause
exit /b 1
