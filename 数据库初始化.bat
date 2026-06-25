@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

title g-daipai 数据库初始化脚本
echo ========================================
echo   g-daipai 数据库初始化（SQLite + 管理员账号）
echo ========================================
echo.

where /Q node
if errorlevel 1 (
  echo 未检测到 Node.js，请先执行 setup-env.bat 完成环境安装。
  exit /b 1
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
  echo DATABASE_URL 不是 sqlite 格式：%DB_URL%
  echo 请在 .env 中设置 DATABASE_URL=sqlite:./data/gdaipai.db 后重试。
  exit /b 1
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
  echo 检测到数据库文件：%DB_PATH%
) else (
  echo 未检测到数据库文件，将创建：%DB_PATH%
)

set "ADMIN_USER=admin"
set "ADMIN_PASS=admin123"
set "DB_PATH=%DB_PATH%"

node scripts/bootstrap-db-admin.js

if errorlevel 1 goto :bootstrap_fail

echo.
echo 完成。管理员账号：admin / admin123
echo 下一步：执行 "node src/server/index.js" 启动 API 服务。
exit /b 0

:bootstrap_fail
echo 数据库初始化失败，请确认已安装依赖（better-sqlite3、bcryptjs）后重试。
exit /b 1
