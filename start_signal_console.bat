@echo off
setlocal

set "PORT=3000"
set "URL=http://localhost:%PORT%"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"

cd /d "%~dp0"

if exist "%ProgramFiles%\nodejs" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node/npm was not found on PATH.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$connections = Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($processId in $connections) { try { Stop-Process -Id $processId -Force -ErrorAction Stop } catch {} }"

echo Starting Signal Console on %URL% ...
echo Opening %URL% automatically when ready...
if exist "%CHROME%" (
  start "" powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "$url = '%URL%'; $chrome = '%CHROME%'; for ($i = 0; $i -lt 80; $i++) { try { $response = Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { Start-Process -FilePath $chrome -ArgumentList $url; exit 0 } } catch {} Start-Sleep -Milliseconds 500 }; Start-Process -FilePath $chrome -ArgumentList $url"
) else (
  start "" powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "$url = '%URL%'; for ($i = 0; $i -lt 80; $i++) { try { $response = Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { Start-Process $url; exit 0 } } catch {} Start-Sleep -Milliseconds 500 }; Start-Process $url"
)

echo Leave this window open while the website is running.
echo.
call npm.cmd run dev -- -p %PORT%
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Signal Console stopped.
pause

endlocal
exit /b %EXIT_CODE%
