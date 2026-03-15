@echo off
title PrintPortal — First Time Setup
color 0A
echo.
echo  =========================================
echo   PrintPortal — Windows Setup
echo  =========================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Please download and install Node.js from https://nodejs.org
    echo  Then run this setup again.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js found: %NODE_VER%

:: Install dependencies
echo.
echo  Installing dependencies...
call npm install --prefix "%~dp0.."
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed!
    pause
    exit /b 1
)
echo  [OK] Dependencies installed

:: Run setup wizard
echo.
echo  Running setup wizard...
node "%~dp0..\scripts\setup.js"

echo.
echo  =========================================
echo   Setup complete! Run START_SERVER.bat
echo  =========================================
pause
