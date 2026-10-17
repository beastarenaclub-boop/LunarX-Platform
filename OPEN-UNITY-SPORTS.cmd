@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "ARENA_PROJECT_PATH=%~dp0artifacts\unity-sports"
start "Arena Unity Editor" "C:\Program Files\Unity\Hub\Editor\6000.5.9f1\Editor\Unity.exe" -projectPath "%ARENA_PROJECT_PATH%"
