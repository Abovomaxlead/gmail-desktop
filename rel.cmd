@echo off
cd /d %~dp0
echo === npm install === > rel.log
call npm install >> rel.log 2>&1
echo === npm run dist === >> rel.log
call npm run dist >> rel.log 2>&1
echo EXITCODE=%ERRORLEVEL% >> rel.log
echo === DONE === >> rel.log
