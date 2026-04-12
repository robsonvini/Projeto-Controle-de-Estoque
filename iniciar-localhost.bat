@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "PORT_PID="

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  set "PORT_PID=%%a"
  goto open_browser
)

if not exist "%BACKEND_DIR%\package.json" (
  echo Nao foi possivel localizar a pasta backend.
  pause
  exit /b 1
)

if not exist "%BACKEND_DIR%\node_modules" (
  echo Dependencias do backend nao encontradas.
  echo Execute npm.cmd install dentro da pasta backend antes de iniciar.
  pause
  exit /b 1
)

start "Controle de Estoque - Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && npm.cmd start"

timeout /t 2 /nobreak >nul
goto open_browser

:open_browser
start "" http://localhost:3000

endlocal