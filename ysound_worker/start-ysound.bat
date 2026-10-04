@echo off
REM ysound song computer: starts the AI model and then makes songs until you close this window (or press Ctrl+C).
REM Uses your normal Python (the worker needs nothing but the standard library).
cd /d "%~dp0"
python run_all.py
pause
