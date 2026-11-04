@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren. & pause & exit /b 1)
if exist PREBUILT (
  if not exist node_modules (
    echo Installiere Abhaengigkeiten...
    call npm install --omit=dev || (pause & exit /b 1)
  )
  call npm run server
  pause
  exit /b
)
if not exist node_modules (
  echo Installiere Abhaengigkeiten...
  call npm install || (pause & exit /b 1)
)
call npm start
pause
