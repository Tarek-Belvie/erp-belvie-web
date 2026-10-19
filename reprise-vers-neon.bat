@echo off
chcp 65001 >nul
title Belvie ERP - bascule des donnees vers la base en ligne
cd /d "%~dp0"
if not exist node_modules\express call npm install --no-audit --no-fund
node tools\reprise-donnees\vers-neon.js
pause
