@echo off
cd /d %~dp0
echo === npm install (root) ===
call npm install || exit /b 1
echo === npm install (renderer) ===
cd renderer
call npm install || exit /b 1
cd ..
echo === npm run dist (build + electron-builder NSIS) ===
call npm run dist || exit /b 1
echo === DONE ===
