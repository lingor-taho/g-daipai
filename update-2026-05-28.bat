@echo off
chcp 65001 >nul
echo ========================================
echo g-daipai 2026-05-28 更新脚本
echo ========================================
echo.

echo [1/5] 检查当前目录...
cd /d C:\www\g-daipai
if errorlevel 1 (
    echo 错误：无法切换到 C:\www\g-daipai
    pause
    exit /b 1
)
echo 当前目录：%CD%
echo.

echo [2/5] 获取最新代码...
git fetch origin
if errorlevel 1 (
    echo 错误：git fetch 失败
    pause
    exit /b 1
)
echo.

echo [3/5] 重置到最新版本...
git reset --hard origin/master
if errorlevel 1 (
    echo 错误：git reset 失败
    pause
    exit /b 1
)
echo.

echo [4/5] 显示当前版本...
git rev-parse --short HEAD
git log -1 --oneline
echo.

echo [5/5] 检查文件状态...
git status --short
echo.

echo ========================================
echo 更新完成！
echo ========================================
echo.
echo 接下来需要手动操作：
echo 1. 重启 API Server（如果服务端代码有更新）
echo 2. 重新构建前端（如果前端代码有更新）：
echo    - cd src\client ^&^& npm run build
echo    - cd src\admin ^&^& npm run build
echo 3. 发布前端构建产物到 Web 服务器
echo.
echo 本次更新内容：
echo - 支持起拍价出价（客户端）
echo - 订单管理字段完善（后台）
echo - 菜单折叠功能（后台）
echo.
pause
