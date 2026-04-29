@echo off
setlocal

cd /d "%~dp0"

if "%~1"=="" (
  set "PORT=3011"
) else (
  set "PORT=%~1"
)

"C:\Program Files\nodejs\node.exe" src\server.js
