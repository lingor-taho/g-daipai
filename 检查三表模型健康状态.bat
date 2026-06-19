@echo off
chcp 65001 >nul
cd /d "%~dp0"
call check-product-health.bat
