@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Checking product three-table health...
echo.

node scripts\check-product-health.js

echo.
if errorlevel 1 (
  echo Result: FAIL. Please check the messages above.
) else (
  echo Result: OK or WARN. WARN means fallback data still exists.
)
echo.
pause
