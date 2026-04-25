@echo off
setlocal
cd /d "%~dp0"
set "PORT=3000"

if not exist node_modules (
  echo Installing npm packages...
  call npm.cmd install
  if errorlevel 1 exit /b 1
)

if not exist "strategy\us_treasury_10y_note_futures_momentum\backtest_trades.csv" (
  echo Building missing backtest file...
  call python backtest-engine\runner.py run-backtests
  if errorlevel 1 exit /b 1
)

:find_port
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  set /a PORT+=1
  goto find_port
)

set "BROWSER_EXE="
if exist "%ProgramFiles%\Chromium\Application\chrome.exe" set "BROWSER_EXE=%ProgramFiles%\Chromium\Application\chrome.exe"
if not defined BROWSER_EXE if exist "%LocalAppData%\Chromium\Application\chrome.exe" set "BROWSER_EXE=%LocalAppData%\Chromium\Application\chrome.exe"
if not defined BROWSER_EXE if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"

start "Trading Bot Server" cmd /k "cd /d %~dp0 && npm.cmd run dev -- --port %PORT%"
timeout /t 8 /nobreak >nul

if defined BROWSER_EXE (
  start "" "%BROWSER_EXE%" http://localhost:%PORT%
) else (
  start "" http://localhost:%PORT%
)
