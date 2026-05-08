@echo off
setlocal
cd /d "%~dp0"

echo Preparing project clone...
echo Rules:
echo 1. Ignore files in .gitignore
echo 2. Explicitly INCLUDE mediapipe models and assets
echo 3. EXCLUDE test files (*.test.*, *.spec.*, tests/)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File ".\prepare_clone.ps1"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Done! The clean clone is in the parent directory:
    echo %~dp0..\Live_MR_Export
) else (
    echo.
    echo Failed to prepare clone.
)

pause
