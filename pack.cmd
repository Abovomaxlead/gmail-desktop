@echo off
cd /d %~dp0
echo === clearing winCodeSign cache === > pack.log
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" 2>nul
echo === running electron-builder (elevated) === >> pack.log
call node_modules\.bin\electron-builder.cmd --win nsis >> pack.log 2>&1
echo EXITCODE=%ERRORLEVEL% >> pack.log
echo === DONE === >> pack.log
