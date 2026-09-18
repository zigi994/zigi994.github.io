@echo off
chcp 65001 >nul
title Kelsey Portfolio - Local Preview
echo.
echo   作品集本地预览
echo   ----------------------------------------
echo   浏览器会自动打开 http://localhost:8787
echo   关闭这个窗口即可停止服务。
echo.
echo   （必须通过服务器打开：直接双击 index.html
echo    会因为浏览器安全策略而无法加载交互脚本。）
echo.
start "" http://localhost:8787
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0site\_tools\serve.ps1" -Port 8787
