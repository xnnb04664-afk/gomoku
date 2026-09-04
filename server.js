/**
 * 五子棋超轻量本地服务 (Node.js 原生零外部依赖)
 * 启动后自动提供 HTTP 静态服务，解决浏览器 file:// 协议对 WebRTC 的安全限制
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const configuredPort = Number(process.env.GOMOKU_PORT || 3000);
const PORT = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535
  ? configuredPort
  : 3000;
const HOST = '127.0.0.1';
const ROOT_DIR = path.resolve(__dirname);
const PUBLIC_ROOT_FILES = new Set([
  'index.html',
  'theme1_zen_dark.html',
  'theme2_neo_traditional.html',
  'theme3_luxury_glass.html',
  'theme4_clean_ios.html',
  'theme5_sweet_romance.html',
  '五子棋大师_单文件版.html',
  'favicon.png'
]);
const PUBLIC_ROOT_DIRS = new Set(['css', 'js', 'img']);
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
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD' });
    res.end('405 Method Not Allowed');
    return;
  }

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
  if (requestPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  const filePath = path.resolve(ROOT_DIR, requestPath);
  const relativePath = path.relative(ROOT_DIR, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  const relativeParts = relativePath.split(path.sep);
  if (relativeParts.some(part => part.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const isAllowed = relativeParts.length === 1
    ? PUBLIC_ROOT_FILES.has(relativeParts[0])
    : PUBLIC_ROOT_DIRS.has(relativeParts[0]);
  if (!isAllowed) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      if (err && !['ENOENT', 'ENOTDIR'].includes(err.code)) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Server Error: ${err.code || 'STAT_FAILED'}`);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      }
      return;
    }

    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Last-Modified': stat.mtime.toUTCString(),
      'ETag': etag,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    };
    if (req.headers['if-none-match'] === etag || req.headers['if-none-match'] === '*') {
      const notModifiedHeaders = { ...headers };
      delete notModifiedHeaders['Content-Length'];
      res.writeHead(304, notModifiedHeaders);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', streamErr => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Server Error: ${streamErr.code || 'READ_FAILED'}`);
      } else {
        res.destroy(streamErr);
      }
    });
    stream.pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`=========================================`);
  console.log(` 五子棋游戏本地服务已启动！`);
  console.log(` 本机浏览器访问: http://localhost:${PORT}`);
  console.log(`=========================================`);
});
