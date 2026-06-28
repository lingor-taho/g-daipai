@echo off
setlocal

cd /d "%~dp0"

set "PRODUCT_ID=%~1"
if "%PRODUCT_ID%"=="" set "PRODUCT_ID=m1235180746"

echo This will clean duplicate orders for product: %PRODUCT_ID%
echo It will create a database backup before changing data.
echo.
set /p CONFIRM=Type YES to continue: 
if /I not "%CONFIRM%"=="YES" (
  echo Cancelled.
  exit /b 1
)

node scripts\cleanup-duplicate-order-product.js "%PRODUCT_ID%" --apply
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Cleanup failed with exit code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)

echo Cleanup finished.
pause
exit /b 0
