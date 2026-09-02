@echo off
chcp 65001 >nul
echo 正在启动五子棋游戏服务...
start http://localhost:3000
node server.js
pause
