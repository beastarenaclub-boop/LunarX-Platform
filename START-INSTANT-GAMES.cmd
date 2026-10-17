@echo off
cd /d "%~dp0"
docker compose up -d --build --wait api web
if errorlevel 1 (
  echo Could not start the games. Check that Docker Desktop is running and its engine is ready.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:5200/"
