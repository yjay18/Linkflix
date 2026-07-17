/* Internal HTTP server for the Electron shell.
   Mirrors server.py: serves the static frontend and handles the atomic
   POST /api/save-library autosave. This is the backend that later phases
   (Ollama proxy, ffmpeg/HLS streaming, folder scanning) extend. */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/* Atomic write of library/library.json — identical semantics to server.py:
   write a temp file on the same filesystem, then rename over the target. */
async function saveLibrary(rootDir, payload) {
  const library = payload && payload.library;
  if (!Array.isArray(library)) throw new Error('Expected a library array');
  const dir = path.join(rootDir, 'library');
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, 'library.json');
  const tmp = path.join(dir, `.library.${process.pid}.${Date.now()}.tmp`);
  const data = JSON.stringify({ library }, null, 2) + '\n';
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, target);
  return path.relative(rootDir, target);
}

function serveStatic(rootDir, req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.normalize(path.join(rootDir, urlPath));
  // path-traversal guard: never serve outside the project root
  if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep))
    return send(res, 403, 'Forbidden');
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

function handle(rootDir, req, res) {
  const pathname = req.url.split('?')[0];
  if (req.method === 'POST' && pathname === '/api/save-library') {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 200 * 1024 * 1024) req.destroy();   // 200 MB guard
    });
    req.on('end', async () => {
      try {
        const rel = await saveLibrary(rootDir, JSON.parse(body || '{}'));
        send(res, 200, JSON.stringify({ ok: true, path: rel }),
          { 'Content-Type': 'application/json' });
      } catch (e) {
        send(res, 400, JSON.stringify({ ok: false, error: String(e.message || e) }),
          { 'Content-Type': 'application/json' });
      }
    });
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(rootDir, req, res);
  send(res, 405, 'Method not allowed');
}

/* Start on preferredPort, walking forward a few ports if it's taken.
   Resolves { server, port }. */
function startServer(rootDir, preferredPort = 4174) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handle(rootDir, req, res));
    let port = preferredPort;
    const maxPort = preferredPort + 25;
    let settled = false;
    server.on('error', err => {
      if (err.code === 'EADDRINUSE' && port < maxPort) {
        port += 1;
        server.listen(port, '127.0.0.1');
      } else if (!settled) {
        settled = true;
        reject(err);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      settled = true;
      resolve({ server, port });
    });
  });
}

module.exports = { startServer, saveLibrary };
