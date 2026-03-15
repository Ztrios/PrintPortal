@echo off
title PrintPortal Server
color 0A
echo.
echo  =========================================
echo   PrintPortal — Starting Server
echo  =========================================
echo.

:: Get local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCAL_IP=%%a
    goto :found
)
:found
set LOCAL_IP=%LOCAL_IP: =%

echo  Server starting...
echo  ─────────────────────────────────────────
echo  Local:    http://localhost:5000
echo  Network:  http://%LOCAL_IP%:5000
echo  ─────────────────────────────────────────
echo  Share the Network URL with your colleagues
echo  Press Ctrl+C to stop the server
echo.

node "%~dp0server\server.js"
pause
