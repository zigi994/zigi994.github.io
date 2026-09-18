@echo off
chcp 65001 >nul
title zigi994 - Local Preview
echo.
echo   作品集本地预览
echo   ----------------------------------------
echo   站点   http://localhost:8787
echo   工具   http://localhost:8787/__tools/audit.html
echo.
echo   关闭这个窗口即可停止服务。
echo   （必须通过服务器打开：直接双击 index.html 会因为
echo    浏览器安全策略而无法加载模块脚本。）
echo.
start "" http://localhost:8787
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" -Port 8787
