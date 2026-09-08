#!/bin/bash
# NIMBY · 财务地图分析台 — macOS / Linux 启动脚本
# 自动寻找可用的本地静态服务器并打开浏览器。
cd "$(dirname "$0")"
PORT=8137
URL="http://127.0.0.1:$PORT/index.html"

if command -v node >/dev/null 2>&1; then
  ( sleep 1.2; open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null ) &
  exec node -e '
    const http=require("http"),fs=require("fs"),path=require("path");
    const root=process.cwd();
    const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".svg":"image/svg+xml",".woff2":"font/woff2",".tsv":"text/tab-separated-values"};
    http.createServer((req,res)=>{
      let p=decodeURIComponent((req.url||"/").split("?")[0]);
      if(p==="/")p="/index.html";
      const f=path.join(root,p);
      if(!f.startsWith(root)){res.writeHead(403);return res.end();}
      fs.readFile(f,(e,d)=>{ if(e){res.writeHead(404);res.end("not found");return;} res.writeHead(200,{"Content-Type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream"});res.end(d);});
    }).listen(process.env.PORT||8137,"127.0.0.1",()=>console.log("server on http://127.0.0.1:"+(process.env.PORT||8137)));
  '
elif command -v python3 >/dev/null 2>&1; then
  ( sleep 1.2; open "$URL" 2>/dev/null ) &
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v python >/dev/null 2>&1; then
  ( sleep 1.2; open "$URL" 2>/dev/null ) &
  exec python -m SimpleHTTPServer "$PORT"
else
  echo "未找到 node / python3。请直接双击打开 index.html（推荐 Chrome/Edge）。"
  read -n 1 -s -r -p "按任意键关闭…"
fi
