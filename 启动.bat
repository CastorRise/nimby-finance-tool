@echo off
setlocal EnableExtensions
title NIMBY Finance Analysis Tool
cd /d "%~dp0"

rem ============================================================
rem  NIMBY Rails finance & map analysis - local launcher (Win)
rem  Tries: python launcher (py) -> python -> node -> direct open
rem ============================================================

set "RUNTIME="
where py >nul 2>nul
if not errorlevel 1 set "RUNTIME=py"
if not defined RUNTIME (
  where python >nul 2>nul
  if not errorlevel 1 set "RUNTIME=python"
)
if not defined RUNTIME (
  where node >nul 2>nul
  if not errorlevel 1 goto :NODE
)
if defined RUNTIME goto :SERVER

goto :DIRECT

:SERVER
echo Starting local server...
start "" /b %RUNTIME% -m http.server 8137 --bind 127.0.0.1 >nul 2>nul
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8137/index.html
echo.
echo Tool is running at:  http://127.0.0.1:8137/index.html
echo Close this window to stop the server.
pause >nul
exit /b

:NODE
echo Starting local server with Node.js...
start "" /b node -e "var h=require('http'),f=require('fs'),p=require('path'),r=process.cwd();h.createServer(function(q,s){var u=decodeURIComponent((q.url||'/').split('?')[0]);if(u==='/')u='/index.html';var n=p.join(r,u);if(n.indexOf(r)!==0){s.writeHead(403);return s.end();}f.readFile(n,function(e,d){if(e){s.writeHead(404);return s.end('not found');}s.writeHead(200,{'Content-Type':{'html':'text/html; charset=utf-8','js':'text/javascript','css':'text/css','json':'application/json','png':'image/png','tsv':'text/tab-separated-values'}[p.extname(n).slice(1).toLowerCase()]||'application/octet-stream'});s.end(d);});}).listen(8137,'127.0.0.1')" >nul 2>nul
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8137/index.html
echo.
echo Tool is running at:  http://127.0.0.1:8137/index.html
echo Close this window to stop the server.
pause >nul
exit /b

:DIRECT
echo No python/node found. Opening index.html directly in your browser.
echo (Everything still works, including saving data in the browser.)
start "" "%~dp0index.html"
echo.
pause
exit /b
