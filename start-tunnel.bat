@echo off
title LiveMR + Cloudflare Tunnel
cd /d "%~dp0"

echo.
echo  ================================================
echo   LiveMR Tunnel 模式啟動中...
echo  ================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-tunnel.ps1"

pause
