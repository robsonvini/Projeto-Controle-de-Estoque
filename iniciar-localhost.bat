@echo off
setlocal
start "Controle de Estoque API" cmd /k "cd /d ""%~dp0backend"" && npm.cmd run dev"
start "" http://localhost:3000
exit /b 0
