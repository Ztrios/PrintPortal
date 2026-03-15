@echo off
:: Run as Administrator
title PrintPortal — Firewall Setup
color 0A
echo.
echo  =========================================
echo   PrintPortal — Firewall Configuration
echo  =========================================
echo  This will allow port 3000 on the local network.
echo  You must run this as Administrator.
echo.
pause

netsh advfirewall firewall add rule name="PrintPortal" dir=in action=allow protocol=TCP localport=3000
if %errorlevel% neq 0 (
    echo  [ERROR] Failed - are you running as Administrator?
) else (
    echo  [OK] Firewall rule added for port 3000
    echo  Colleagues can now access the portal on your IP.
)
echo.
pause
