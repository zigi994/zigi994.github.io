@echo off
chcp 65001 >nul
title zigi994 preview
echo.
echo   http://localhost:8787
echo   Close this window to stop.
echo.
start "" http://localhost:8787
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" -Port 8787
