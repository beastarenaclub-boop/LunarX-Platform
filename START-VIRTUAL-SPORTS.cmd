@echo off
cd /d "%~dp0"
echo Opening Virtual Sports at http://127.0.0.1:5198
start "" "http://127.0.0.1:5198"
node artifacts/3d-game/virtual-sports-server/server.mjs
pause
