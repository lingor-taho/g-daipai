@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

title g-daipai 环境安装脚本
echo ========================================
echo   g-daipai 环境安装脚本
echo ========================================
echo.

where /Q winget
set "HAS_WINGET=0"
if not errorlevel 1 set "HAS_WINGET=1"

echo [1/6] 检查 Git
where /Q git
if errorlevel 1 (
  if "%HAS_WINGET%"=="0" (
    echo 未检测到 git，且当前环境未安装 winget。
    goto :fail
  )
  echo 未检测到 git，自动使用 winget 安装...
  winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements
  where /Q git
  if errorlevel 1 (
    echo git 安装失败，请检查网络或安装源。
    goto :fail
  )
) else (
  echo git 已存在
)

echo.
echo [2/6] 检查 Node.js
where /Q node
if errorlevel 1 (
  if "%HAS_WINGET%"=="0" (
    echo 未检测到 Node.js，且当前环境未安装 winget。
    goto :fail
  )
  echo 未检测到 Node.js，自动使用 winget 安装...
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  where /Q node
  if errorlevel 1 (
    echo Node.js 安装失败，请检查网络或安装源。
    goto :fail
  )
) else (
  echo Node.js 已存在
)

echo.
echo [3/6] 检查项目目录
if not exist "%ROOT%\package.json" (
  echo 当前目录不是项目根目录：%ROOT%
  goto :fail
)

cd /d "%ROOT%"
echo.
echo [4/6] 拉取最新代码
if not exist "%ROOT%\.git" (
  echo 当前不是 Git 仓库，跳过 git pull。
) else (
  where /Q git
  if errorlevel 1 (
    echo git 命令不可用，跳过 git pull。
  ) else (
    git remote get-url origin > nul 2>&1
    if errorlevel 0 (
      git fetch --all --prune
      git pull
      if errorlevel 1 (
        echo git pull 失败，请检查网络/分支状态。
        goto :fail
      )
    ) else (
      echo 未配置 origin 远程仓库，跳过 git pull。
    )
  )
)

echo.
echo [5/6] 初始化 .env
if not exist "%ROOT%\.env" (
  if exist "%ROOT%\.env.example" (
    copy /Y "%ROOT%\.env.example" "%ROOT%\.env" > nul
    echo 已从 .env.example 复制生成 .env
  ) else (
    echo 未检测到 .env 且未发现 .env.example，请手动提供配置文件
    goto :fail
  )
) else (
  echo .env 已存在
)

echo.
echo [6/6] 安装依赖
cd /d "%ROOT%"
echo 安装根目录依赖...
npm install
if errorlevel 1 goto :fail

if exist "src\client\package.json" goto :install_client
if exist "src\admin\package.json" goto :install_admin
goto :end_install

:install_client
echo 安装前端依赖...
cd /d "%ROOT%\src\client"
npm install
if errorlevel 1 goto :fail
if exist "%ROOT%\src\admin\package.json" goto :install_admin
goto :end_install

:install_admin
echo 安装管理后台依赖...
cd /d "%ROOT%\src\admin"
npm install
if errorlevel 1 goto :fail

:end_install

echo.
echo 完成。
node -v
npm -v
echo.
echo git pull 只会更新代码，不会创建 SQLite 数据库。
echo 新机器若无数据库，请先执行 setup-db-admin.bat。
echo.
echo root: %ROOT%
exit /b 0

:fail
echo.
echo 初始化失败，请根据上方提示处理后重试。
exit /b 1
