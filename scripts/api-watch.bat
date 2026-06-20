@echo off
chcp 65001 > nul
setlocal

set "ROOT=%~1"
if "%ROOT%"=="" (
  set "ROOT=%~dp0.."
)

pushd "%ROOT%" > nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] failed to enter project directory: %ROOT%
  exit /b 1
)

:loop
echo [%date% %time%] starting API >> "%ROOT%\server-start.log"
node src\server\index.js >> "%ROOT%\server-start.log" 2>> "%ROOT%\server-start.err.log"
set "EXIT_CODE=%ERRORLEVEL%"
echo [%date% %time%] API exited with code %EXIT_CODE% >> "%ROOT%\server-start.err.log"
timeout /t 5 > nul
goto loop
