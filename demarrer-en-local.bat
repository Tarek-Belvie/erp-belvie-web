@echo off
chcp 65001 >nul
title Belvie ERP - local
cd /d "%~dp0"
node tools\local\demarrer.js
pause
