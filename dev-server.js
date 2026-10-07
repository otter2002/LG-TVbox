/*
 * 电脑上调试用：静态托管 app/ 目录，并提供 /proxy?url= 转发请求以绕开浏览器 CORS。
 * 仅监听 127.0.0.1。用法：npm run dev  然后打开 http://127.0.0.1:8080
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const PORT = Number(process.env.PORT) || 8080;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

// 内置爬虫引擎（与电视上的 JS 服务是同一份构建产物：npm run build:service）
let engine = null;
function getEngine() {
  if (!engine) engine = require('./services/engine.js').createEngine({ poolSize: 3 });
  return engine;
}

function spider(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    try {
      const p = JSON.parse(body || '{}');
      const data = await getEngine().call(p.site, p.action, p.args || [], p.timeout);
      send({ ok: true, data });
    } catch (e) {
      send({ ok: false, error: e.message });
    }
  });
}

async function proxy(target, res) {
  if (!/^https?:\/\//i.test(target || '')) {
    res.writeHead(400);
    return res.end('invalid url');
  }
  try {
    const r = await fetch(target, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'text/plain' });
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('proxy error: ' + e.message);
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/proxy') return proxy(u.searchParams.get('url'), res);
  if (u.pathname === '/spider' && req.method === 'POST') return spider(req, res);

  const file = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`TVBox dev server: http://127.0.0.1:${PORT}`);
  console.log('键盘：方向键导航，Enter 确认，Esc/Backspace 返回');
});
