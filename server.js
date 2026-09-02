/**
 * 五子棋超轻量本地服务 (Node.js 原生零外部依赖)
 * 启动后自动提供 HTTP 静态服务，解决浏览器 file:// 协议对 WebRTC 的安全限制
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let requestPath = (req.url || '/').split('?')[0];
  try {
    requestPath = decodeURIComponent(requestPath);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  // 解码后再拼接路径，既支持中文文件名，也阻止 ../ 路径穿越。
  requestPath = requestPath.replace(/^[/\\]+/, '');
  if (!requestPath) requestPath = 'index.html';
  const rootDir = path.resolve(__dirname);
  const filePath = path.resolve(rootDir, requestPath);
  const relativePath = path.relative(rootDir, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(` 五子棋游戏本地服务已启动！`);
  console.log(` 本机浏览器访问: http://localhost:${PORT}`);
  console.log(`=========================================`);
});
