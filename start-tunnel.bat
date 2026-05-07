@echo off
chcp 65001 > nul
title LiveMR with Cloudflare Tunnel
cd /d "%~dp0"

echo.
echo  ================================================
echo   LiveMR Tunnel mode starting...
echo  ================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-tunnel.ps1"

pause
