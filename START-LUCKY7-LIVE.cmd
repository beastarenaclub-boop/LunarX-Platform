@echo off
cd /d "%~dp0"
docker compose up -d --no-build --wait api web
if errorlevel 1 (
  echo Could not start Lucky 7 Live. Check that Docker Desktop is running.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:5200/lucky-7-live"
