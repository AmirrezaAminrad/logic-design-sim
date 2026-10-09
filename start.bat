@echo off
title Logic Design Sim
rem Logic Design Sim easy start
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Node.js is required.
    echo Install it from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo.
    echo Installing dependencies - first run only...
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo npm install failed - see the error above.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo Starting Logic Design Sim...
echo A browser window will open when the server is ready.
echo Close this window (or press Ctrl+C) to stop the app.
echo.
npm run dev -- --open
