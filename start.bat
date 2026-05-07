@echo off
chcp 65001 > nul
title LiveMR Launcher
cd /d "%~dp0"

echo.
echo  ================================================
echo   LiveMR Starting...
echo  ================================================
echo.

where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Docker not found. Please install Docker Desktop.
    echo  Download: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

where openssl >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%ProgramFiles%\Git\usr\bin\openssl.exe" (
        set "PATH=%ProgramFiles%\Git\usr\bin;%PATH%"
    ) else (
        echo  [ERROR] openssl not found. Please install Git for Windows.
        echo  Download: https://git-scm.com/download/win
        echo.
        pause
        exit /b 1
    )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

pause
