@echo off
cd /d "%~dp0"
call npm run lunar:colour:build
if errorlevel 1 goto failed
echo Open http://localhost:5192 in your browser.
call npm run lunar:colour:start
goto :eof
:failed
echo Lunar Colour Trading could not build. Please check the error above.
pause
