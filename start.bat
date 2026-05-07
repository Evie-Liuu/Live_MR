@echo off
title LiveMR 啟動器
cd /d "%~dp0"

echo.
echo  ================================================
echo   LiveMR 啟動中...
echo  ================================================
echo.

where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo  [錯誤] 找不到 Docker，請先安裝 Docker Desktop。
    echo  下載：https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

where openssl >nul 2>&1
if %errorlevel% neq 0 (
    echo  [錯誤] 找不到 openssl，請安裝 Git for Windows。
    echo  下載：https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

pause
