@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\sports-assets\build-unity.ps1"
if errorlevel 1 goto failed
call npm run sports:build
if errorlevel 1 goto failed
echo Unity WebGL build is ready. Launch START-VIRTUAL-SPORTS.cmd to view it.
pause
exit /b 0
:failed
echo Build could not finish. See tmp\unity-sports\build.log for the Unity error.
pause
exit /b 1
