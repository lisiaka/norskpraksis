@echo off
echo.
echo   Norsk B2 Treningsverktoey
echo   Starter lokal server...
echo.
python start_server.py
if errorlevel 1 (
    echo.
    echo   Python ikke funnet. Proev:
    echo   python3 start_server.py
    pause
)
