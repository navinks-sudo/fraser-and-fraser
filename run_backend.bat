@echo off
REM Keep the backend alive outside Claude's background wrapper.
REM Double-click this file (or run from cmd) and leave the window open.
cd /d "%~dp0"
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 600
pause
