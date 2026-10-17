@echo off
cd /d "%~dp0"
docker compose up -d --no-build --wait api admin operator web b2b
if errorlevel 1 (
  echo Start Docker Desktop and try again. See README.md for first-time builds.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:5175/admin/network"
echo Master: http://127.0.0.1:5176/master/
echo Agent:  http://127.0.0.1:5176/agent/
echo B2B:    http://127.0.0.1:5202/
echo B2C:    http://127.0.0.1:5200/
