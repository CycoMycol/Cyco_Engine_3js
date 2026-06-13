@echo off
setlocal
set "ROOT=%~dp0.."
set "URL=http://127.0.0.1:4173/"

start "" /b node "%ROOT%\tools\cyco-editor-server.mjs"
timeout /t 2 /nobreak >nul
start "" "%URL%"

