@echo off
cd /d "%~dp0"
if not exist out mkdir out
echo Compiling...
javac -encoding UTF-8 -d out src\ThakurBank.java
if errorlevel 1 (
  echo.
  echo Compile failed. Is the JDK installed? Take a screenshot of this window.
  pause
  exit /b
)
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8080"
echo Thakur Bank starting... close this window to stop the server.
java -cp out ThakurBank
pause
