@echo off
setlocal
cd /d "%~dp0"
set HORSE_PREVIEW_PORT=5293
echo Horse Racing betting game: http://127.0.0.1:5293/horse-racing
echo Keep the main game services on port 5200 running for login and wallet.
echo Graphics-only preview: http://127.0.0.1:5293/unity-horse/index.html
node -e "fetch('http://127.0.0.1:5293/unity-horse/ready.json').then(r=>r.json()).then(d=>process.exit(d.visualRevision>=4?(d.engine==='unity-urp'?0:1):1)).catch(()=>process.exit(1))" >nul 2>&1
if not errorlevel 1 (
  start "" "http://127.0.0.1:5293/horse-racing"
  exit /b 0
)
node tools/horse-assets/serve-stable.mjs
pause
