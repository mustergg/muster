@echo off
title Muster Build
echo.
echo [Muster] Building all packages...
echo.
cd /d "%~dp0"

echo [1/3] Building packages...
pnpm --filter "./packages/**" build
if errorlevel 1 (
    echo.
    echo [ERROR] Package build failed!
    pause
    exit /b 1
)

echo.
echo [2/3] Building web app...
pnpm --filter @muster/web build
if errorlevel 1 (
    echo.
    echo [ERROR] Web app build failed!
    pause
    exit /b 1
)

echo.
echo [3/3] Building node app...
pnpm --filter @muster/node build
if errorlevel 1 (
    echo.
    echo [ERROR] Node build failed!
    pause
    exit /b 1
)

echo.
echo [Muster] All builds successful!
pause
