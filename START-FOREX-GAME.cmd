@echo off
cd /d "%~dp0"
call npm run forex:build
if errorlevel 1 goto failed
echo Open http://127.0.0.1:5196 in your browser.
call npm run forex:start
goto :eof
:failed
echo Aurum could not build. Please check the error above.
pause
