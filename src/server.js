'use strict';

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { handleApi } = require('./routes/api');
const { store, sanitize } = require('./services/downloader');
const { initDatabase, isDatabaseEnabled } = require('./services/database');

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.ttf':   'font/ttf',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ── API ───────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, pathname, u);
    if (handled) return;
  }

  // ── SSE ───────────────────────────────────────────────────────────────────
  if (pathname === '/events') {
    const clientId = Date.now() + Math.random();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    store.sseClients.set(clientId, res);
    for (const dl of store.downloads.values()) res.write(`data: ${JSON.stringify({ type: 'update', download: sanitize(dl) })}\n\n`);
    req.on('close', () => store.sseClients.delete(clientId));
    return;
  }

  // ── Static Files ──────────────────────────────────────────────────────────
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  
  // Security check: ensure path is within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404);
  res.end('Not found');
});

initDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n  ▶  SP Downloader  —  http://localhost:${PORT}`);
      console.log(`  Platform : ${process.platform}`);
      console.log(`  History  : ${isDatabaseEnabled() ? 'MongoDB' : 'local JSON file (~/.vdl_history.json)'}\n`);
    });
  })
  .catch((error) => {
    console.error('MongoDB init failed:', error.message);
    process.exit(1);
  });
