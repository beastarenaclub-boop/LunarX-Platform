@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\horse-assets\build-unity.ps1"
if errorlevel 1 goto done
echo Unity horse racing build ready.
:done
pause
