@echo off
rem Linkflix launcher (Windows) - double-click me
cd /d "%~dp0"
start "Linkflix server" /min cmd /c "py server.py || python server.py"
timeout /t 1 >nul
start "" "http://localhost:4173/index.html"
