@echo off
setlocal
cd /d "%~dp0"
echo Repairing legacy P order times using the normal/shop convention.
echo A verified database backup is created before any update.
node scripts\repair-fleamarket-order-time.js --apply
set "REPAIR_EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%REPAIR_EXIT_CODE%"=="0" echo Repair failed. Review the error above.
pause
exit /b %REPAIR_EXIT_CODE%
