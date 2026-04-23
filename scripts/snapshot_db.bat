@echo off
REM Wrapper so Windows Task Scheduler can run the Python snapshot script
REM without worrying about PATH. Uses the backend's uv-managed venv.

setlocal
cd /d "%~dp0\.."

"%~dp0\..\backend\.venv\Scripts\python.exe" "%~dp0\snapshot_db.py"
exit /b %ERRORLEVEL%
