@echo off
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Start Docker Desktop to run Bike Racing with the shared casino wallet.
  pause
  exit /b 1
)
docker compose up -d --build api web
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "http://127.0.0.1:5200/bike-racing"
