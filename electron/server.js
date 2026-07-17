/* Internal HTTP server for the Electron shell.
   Mirrors server.py: serves the static frontend and handles the atomic
   POST /api/save-library autosave. This is the backend that later phases
   (Ollama proxy, ffmpeg/HLS streaming, folder scanning) extend. */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const media = require('./media');

const MEDIA_MIME = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/mp4',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8'
};

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

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/* GET /api/models — the Ollama models the user has pulled (for the Settings picker). */
async function ollamaModels(res) {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    send(res, 200, JSON.stringify({ models: (d.models || []).map(m => m.name) }),
      { 'Content-Type': 'application/json' });
  } catch (e) {
    send(res, 502, JSON.stringify({ models: [], error: `Ollama not reachable: ${e.message || e}` }),
      { 'Content-Type': 'application/json' });
  }
}

/* POST /api/concierge — proxy a chat to Ollama and stream the NDJSON reply back.
   Keeps everything same-origin (no CORS) and lets us manage the local model. */
async function ollamaConcierge(res, body) {
  let payload;
  try { payload = JSON.parse(body || '{}'); }
  catch { return send(res, 400, JSON.stringify({ error: 'bad JSON' }), { 'Content-Type': 'application/json' }); }
  const model = payload.model || 'llama3.2';
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const temperature = typeof payload.temperature === 'number' ? payload.temperature : 0.4;

  const ac = new AbortController();
  res.on('close', () => ac.abort());

  let upstream;
  try {
    upstream = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options: { temperature } }),
      signal: ac.signal
    });
  } catch (e) {
    return send(res, 502, JSON.stringify({ error: `Ollama not reachable at ${OLLAMA}. Is it running? (${e.message || e})` }),
      { 'Content-Type': 'application/json' });
  }
  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    return send(res, 502, JSON.stringify({ error: `Ollama error ${upstream.status}: ${t.slice(0, 200)}` }),
      { 'Content-Type': 'application/json' });
  }
  res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  try {
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(dec.decode(value, { stream: true }));
    }
  } catch { /* aborted or client disconnected */ }
  res.end();
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

/* Resolve a playable local path from the SAVED library (never from the URL) —
   the path comes from library.json, which the user populated via the picker/scanner. */
async function resolveLocalPath(rootDir, id, s, e) {
  let raw;
  try { raw = await fsp.readFile(path.join(rootDir, 'library', 'library.json'), 'utf8'); }
  catch { return null; }
  let lib;
  try { lib = JSON.parse(raw).library; } catch { return null; }
  const item = (lib || []).find(i => i.id === id);
  if (!item) return null;
  const p = item.type === 'movie'
    ? item.localPath
    : item.seasons?.[s]?.episodes?.[e]?.localPath;
  if (!p) return null;
  try { if (!fs.statSync(p).isFile()) return null; } catch { return null; }
  return p;
}

function serveSessionFile(sess, name, res) {
  const file = path.join(sess.dir, path.basename(name));   // basename blocks traversal
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': MEDIA_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* Local-playback routes. Returns true if the request was a media route. */
async function handleMedia(rootDir, res, pathname) {
  let m = pathname.match(/^\/probe\/([^/]+)\/(\d+)\/(\d+)$/);
  if (m) {
    const [, id, s, e] = m;
    const file = await resolveLocalPath(rootDir, id, +s, +e);
    if (!file) { send(res, 404, JSON.stringify({ ok: false, error: 'no local file' }), { 'Content-Type': 'application/json' }); return true; }
    send(res, 200, JSON.stringify(await media.probe(file)), { 'Content-Type': 'application/json' });
    return true;
  }
  m = pathname.match(/^\/hls\/([^/]+)\/(\d+)\/(\d+)\/([\w.]+)$/);
  if (m) {
    const [, id, s, e, name] = m;
    const key = `${id}/${s}/${e}`;
    let sess = media.sessions.get(key);
    if (!sess) {
      const file = await resolveLocalPath(rootDir, id, +s, +e);
      if (!file) { send(res, 404, 'no local file'); return true; }
      sess = await media.ensureHls(key, file, await media.probe(file));
    }
    serveSessionFile(sess, name, res);
    return true;
  }
  m = pathname.match(/^\/subs\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.vtt$/);
  if (m) {
    const [, id, s, e, idx] = m;
    const file = await resolveLocalPath(rootDir, id, +s, +e);
    if (!file) { send(res, 404, 'no local file'); return true; }
    const vtt = await media.subtitleVtt(`${id}/${s}/${e}`, file, +idx);
    const buf = await fsp.readFile(vtt);
    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/vtt; charset=utf-8', 'Content-Length': buf.length });
    res.end(buf);
    return true;
  }
  return false;
}

function handle(rootDir, req, res) {
  const pathname = req.url.split('?')[0];
  if (req.method === 'GET' &&
      (pathname.startsWith('/probe/') || pathname.startsWith('/hls/') || pathname.startsWith('/subs/'))) {
    handleMedia(rootDir, res, pathname)
      .then(done => { if (!done) send(res, 404, 'Not found'); })
      .catch(err => send(res, 500, JSON.stringify({ error: String(err.message || err) }), { 'Content-Type': 'application/json' }));
    return;
  }
  if (req.method === 'GET' && pathname === '/api/models') return ollamaModels(res);
  if (req.method === 'POST' && pathname === '/api/concierge') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', () => ollamaConcierge(res, body));
    return;
  }
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
