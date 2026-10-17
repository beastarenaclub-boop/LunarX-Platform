@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
start "Unity Horse Racing" "C:\Program Files\Unity\Hub\Editor\6000.5.9f1\Editor\Unity.exe" -projectPath "%~dp0artifacts\unity-horse"
