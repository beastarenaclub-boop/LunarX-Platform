@echo off
cd /d "%~dp0"
docker compose up -d --no-build --wait api web
if errorlevel 1 (
  echo Please check that Docker Desktop is running.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:5200/"
