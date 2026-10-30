@echo off
cd /d "%~dp0"
if not exist node_modules call npm.cmd install
start "" http://localhost:3000
call npm.cmd run dev
pause
