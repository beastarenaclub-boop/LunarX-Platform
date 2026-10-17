@echo off
cd /d "%~dp0artifacts\3d-game\syndicate"
if not exist ".sites-runtime\https\localhost.pfx" (
  powershell -NoProfile -File scripts\setup-local-https.ps1
  if errorlevel 1 exit /b 1
)
set "SYNDICATE_LOCAL_HTTPS=1"
echo SYNDICATE HTTPS portal: https://127.0.0.1:5198
node scripts\run-framework.mjs dev --port 5198 --hostname 0.0.0.0
pause
