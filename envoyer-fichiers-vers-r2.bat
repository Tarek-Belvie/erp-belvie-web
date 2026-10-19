@echo off
chcp 65001 >nul
title Belvie ERP - envoi des fichiers vers R2
cd /d "%~dp0"
if not exist node_modules\@aws-sdk\client-s3 call npm install --no-audit --no-fund
node tools\fichiers\envoyer-vers-r2.js
pause
