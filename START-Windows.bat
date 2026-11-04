@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js не встановлено. Завантажте LTS-версію з https://nodejs.org & pause & exit /b)
start "" http://localhost:3000
node server.js
pause
