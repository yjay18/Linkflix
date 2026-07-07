@echo off
rem Linkflix launcher (Windows) - double-click me
cd /d "%~dp0"
start "Linkflix server" /min cmd /c "py -m http.server 4173 --bind 127.0.0.1 || python -m http.server 4173 --bind 127.0.0.1"
timeout /t 1 >nul
start "" "http://127.0.0.1:4173/index.html"
