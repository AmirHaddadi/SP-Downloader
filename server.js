
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { URL } = require('url');
const os = require('os');

// ── Constants ─────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT        || 4000;
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'admin123';
const DEV_MODE    = process.env.DEV_MODE === '1';
const CONFIG_FILE = path.join(os.homedir(), '.vdl_config.json');
const USER_AGENT  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const YTDLP_BIN   = os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_DIR     = path.join(__dirname, 'bin');
const getYtdlpPath = () => fs.existsSync(path.join(BIN_DIR, YTDLP_BIN)) ? path.join(BIN_DIR, YTDLP_BIN) : 'yt-dlp';
function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
function isXHamsterUrl(url) {
  const host = hostnameOf(url);
  return host === 'xhamster.com' || host.endsWith('.xhamster.com');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.ttf':  'font/ttf',
};

// ── Logging (DEV only) ────────────────────────────────────────────────────────
const log = DEV_MODE ? console.log.bind(console) : () => {};

// ── Helpers ───────────────────────────────────────────────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if ([301, 302].includes(response.statusCode)) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) return reject(new Error(`Download failed: ${response.statusCode}`));
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          if (os.platform() !== 'win32') fs.chmodSync(dest, 0o755);
          resolve();
        });
      });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch {
    return {
      downloadFolder: path.join(os.homedir(), 'Downloads', 'VDL'),
      cookiesFrom:    'none',
      cookiesFile:    '',
      proxy:          '',
    };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ── Central State ─────────────────────────────────────────────────────────────
const store = {
  downloads: new Map(),   // id → download object
  nextId:    1,
  sseClients: new Map(),  // clientId → res
  stats: {
    totalDownloads: 0,
    totalBytes:     0,
    errors:         0,
    startTime:      Date.now(),
  },
};

// ── SSE ───────────────────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of store.sseClients.values()) res.write(msg);
}

// ── yt-dlp helpers ────────────────────────────────────────────────────────────
function buildCommonArgs(cfg, url) {
  const c = cfg || loadConfig();
  const xhamster = isXHamsterUrl(url);
  const args = [
    '--user-agent', USER_AGENT,
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
    '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '--add-header', `Referer:${xhamster ? 'https://xhamster.com/' : 'https://www.google.com/'}`,
    '--socket-timeout', '60',
    '--retries', '10',
    '--fragment-retries', '10',
    '--retry-sleep', '3',
    '--no-abort-on-error',
    '--geo-bypass',
  ];
  if (xhamster) {
    args.push(
      '--add-header', 'Origin:https://xhamster.com',
      '--add-header', 'Cookie:xhamster_age_verified=1; age_verified=1; is_age_verified=1'
    );
  }
  if (c.cookiesFrom && c.cookiesFrom !== 'none') args.push('--cookies-from-browser', c.cookiesFrom);
  if (c.cookiesFile && fs.existsSync(c.cookiesFile))  args.push('--cookies', c.cookiesFile);
  if (c.proxy) args.push('--proxy', c.proxy);
  return args;
}

function ytdlpExec(args) {
  return new Promise((resolve, reject) => {
    execFile(getYtdlpPath(), args, { maxBuffer: 16 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').split('\n')
          .filter(l => l.includes('ERROR:')).join(' ') || err.message;
        return reject(new Error(msg));
      }
      resolve(stdout.trim());
    });
  });
}

async function fetchMeta(url) {
  if (!url || !url.match(/^https?:\/\//i)) throw new Error('URL نامعتبر است');
  const cfg = loadConfig();
  const args = [
    '--dump-json', '--no-playlist', '--skip-download',
    ...buildCommonArgs(cfg, url), url,
  ];
  const raw  = await ytdlpExec(args);
  const info = JSON.parse(raw.split('\n').find(l => l.startsWith('{')) || raw);

  const formats = (info.formats || []).filter(f => f.vcodec !== 'none' || f.acodec !== 'none');

  const videoQualities = [...new Set(
    formats.filter(f => f.vcodec !== 'none' && f.height).map(f => f.height + 'p')
  )].sort((a, b) => parseInt(b) - parseInt(a)).slice(0, 6);

  const audioQualities = [...new Set(
    formats.filter(f => f.vcodec === 'none' && f.abr).map(f => Math.round(f.abr) + 'kbps')
  )].sort((a, b) => parseInt(b) - parseInt(a)).slice(0, 5);

  return {
    title:          info.title       || 'Unknown',
    thumb:          info.thumbnail   || '',
    duration:       info.duration    || 0,
    uploader:       info.uploader    || info.channel || '',
    extractor:      info.extractor_key || info.ie_key || '',
    webpage_url:    info.webpage_url || url,
    videoQualities: videoQualities.length ? videoQualities : ['1080p','720p','480p','360p'],
    audioQualities: audioQualities.length ? audioQualities : ['320kbps','192kbps','128kbps','64kbps'],
  };
}

// ── Download Engine ───────────────────────────────────────────────────────────
function sanitize(dl) {
  const { proc, ...rest } = dl;
  return rest;
}

function startDownload(id) {
  const dl = downloads.get ? downloads.get(id) : store.downloads.get(id);
  if (!dl) return;

  const cfg    = loadConfig();
  const folder = cfg.downloadFolder;
  fs.mkdirSync(folder, { recursive: true });

  const args = [
    '--no-playlist', '--newline', '--progress',
    ...buildCommonArgs(cfg, dl.url),
    '-o', path.join(folder, '%(title).100s.%(ext)s'),
  ];

  if (dl.status === 'paused' && dl.filePath && fs.existsSync(dl.filePath + '.part')) {
    args.push('--continue', '--download-archive', path.join(folder, '.yt-dlp-archive'));
  }

  if (dl.format === 'audio') {
    const abr = dl.quality ? dl.quality.replace('kbps', '') : '128';
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', abr, '--no-keep-video');
  } else {
    const height = dl.quality ? dl.quality.replace('p', '') : '480';
    args.push(
      '-f', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`,
      '--merge-output-format', 'mp4'
    );
  }
  args.push(dl.url);

  Object.assign(dl, { status: 'downloading', progress: dl.progress || 0, speed: '', eta: '', errorMsg: '', startTime: Date.now() });
  broadcast({ type: 'update', download: sanitize(dl) });

  const proc = spawn(getYtdlpPath(), args, { windowsHide: true });
  dl.proc = proc;
  let stderrBuf = '';

  proc.stdout.on('data', chunk => {
    for (const line of chunk.toString().split('\n')) {
      const m = line.match(/\[download\]\s+([\d.]+)%.*?at\s+([\d.]+\s*\S+\/s)\s+ETA\s+(\S+)/);
      if (m) {
        dl.progress = parseFloat(m[1]);
        dl.speed    = m[2];
        dl.eta      = m[3];
        if (dl.progress >= 100) dl.status = 'finalizing';
        broadcast({ type: 'update', download: sanitize(dl) });
      }
      const dm = line.match(/\[(?:download|Merger|ffmpeg)\] Destination: (.+)/);
      if (dm) dl.filePath = dm[1].trim();

      const sm = line.match(/of\s+~?\s*([\d.]+)(KiB|MiB|GiB)/i);
      if (sm && !dl.totalBytes) {
        const v = parseFloat(sm[1]), u = sm[2].toUpperCase();
        dl.totalBytes = u === 'GIB' ? v * 1073741824 : u === 'MIB' ? v * 1048576 : v * 1024;
      }
    }
  });

  proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });

  proc.on('close', code => {
    dl.proc = null;
    if (code === 0) {
      Object.assign(dl, { status: 'done', progress: 100, speed: '', eta: '' });
      store.stats.totalDownloads++;
      if (dl.totalBytes) store.stats.totalBytes += dl.totalBytes;
    } else if (!['paused', 'cancelled'].includes(dl.status)) {
      dl.status = 'error';
      store.stats.errors++;
      const errLine = stderrBuf.split('\n').filter(l => l.includes('ERROR:') || l.includes('Postprocessing')).pop() || '';
      dl.errorMsg = errLine.replace(/^.*(?:ERROR|Postprocessing):\s*/, '').trim().substring(0, 150);
      if (isXHamsterUrl(dl.url) && /No video formats found/i.test(dl.errorMsg)) {
        dl.errorMsg = 'XHamster returned no formats. Use browser cookies in settings and run bin\\yt-dlp.exe -U.';
      }
      if (dl.errorMsg.includes('ffmpeg') || dl.errorMsg.includes('ffprobe'))
        dl.errorMsg = 'ffmpeg نصب نیست — winget install ffmpeg';
    }
    broadcast({ type: 'update', download: sanitize(dl) });
  });
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise(resolve => { let b = ''; req.on('data', d => b += d); req.on('end', () => resolve(b)); });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function requireAdmin(req, res) {
  if (req.headers['authorization'] !== ADMIN_PASS) {
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ── Router ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u        = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ── Serve index.html ──────────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'index.html');
    if (!fs.existsSync(htmlPath)) { res.writeHead(404); return res.end('index.html not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(htmlPath));
  }

  // ── Serve static files (CSS, JS, Fonts, Images) ───────────────────────────
  const staticPaths = [
    '/style.css', '/app.js', '/Logo.png', '/favicon.ico'
  ];
  if (staticPaths.includes(pathname) || pathname.startsWith('/fonts/')) {
    const filePath = path.join(__dirname, pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }
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

  // ── /api/meta ─────────────────────────────────────────────────────────────
  if (pathname === '/api/meta' && req.method === 'POST') {
    try {
      const { url } = JSON.parse(await readBody(req));
      json(res, 200, { ok: true, meta: await fetchMeta(url) });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return;
  }

  // ── /api/download ─────────────────────────────────────────────────────────
  if (pathname === '/api/download' && req.method === 'POST') {
    try {
      const { url, title, thumb, format, quality } = JSON.parse(await readBody(req));
      if (!url?.match(/^https?:\/\//i)) return json(res, 400, { ok: false, error: 'URL نامعتبر' });
      const id = store.nextId++;
      const dl = { id, url, title: title || 'Unknown', thumb: thumb || '', format: format || 'video', quality: quality || '', platform: hostnameOf(url), status: 'queued', progress: 0, speed: '', eta: '', filePath: '', errorMsg: '', totalBytes: 0, timestamp: Date.now() };
      store.downloads.set(id, dl);
      broadcast({ type: 'update', download: sanitize(dl) });
      startDownload(id);
      json(res, 200, { ok: true, id });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return;
  }

  // ── /api/download-file ────────────────────────────────────────────────────
  if (pathname === '/api/download-file' && req.method === 'GET') {
    const id = parseInt(u.searchParams.get('id'));
    const dl = store.downloads.get(id);
    if (dl?.status === 'done' && dl.filePath && fs.existsSync(dl.filePath)) {
      const stat = fs.statSync(dl.filePath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(path.basename(dl.filePath))}"`,
      });
      return fs.createReadStream(dl.filePath).pipe(res);
    }
    json(res, 404, { ok: false, error: 'فایل پیدا نشد یا آماده نیست' });
    return;
  }

  // ── /api/cancel ───────────────────────────────────────────────────────────
  if (pathname === '/api/cancel' && req.method === 'POST') {
    const { id } = JSON.parse(await readBody(req));
    const dl = store.downloads.get(id);
    if (dl) {
      dl.status = 'cancelled';
      if (dl.proc) {
        process.platform === 'win32'
          ? spawn('taskkill', ['/F', '/T', '/PID', dl.proc.pid], { windowsHide: true })
          : dl.proc.kill('SIGTERM');
      }
      broadcast({ type: 'update', download: sanitize(dl) });
    }
    json(res, 200, { ok: true });
    return;
  }

  // ── /api/pause ────────────────────────────────────────────────────────────
  if (pathname === '/api/pause' && req.method === 'POST') {
    const { id } = JSON.parse(await readBody(req));
    const dl = store.downloads.get(id);
    if (dl?.proc) {
      dl.status = 'paused';
      if (process.platform === 'win32') {
        spawn('taskkill', ['/F', '/T', '/PID', dl.proc.pid], { windowsHide: true });
        dl.proc = null;
      } else {
        dl.proc.kill('SIGSTOP');
      }
      broadcast({ type: 'update', download: sanitize(dl) });
    }
    json(res, 200, { ok: true, status: dl?.status || 'not_found' });
    return;
  }

  // ── /api/resume ───────────────────────────────────────────────────────────
  if (pathname === '/api/resume' && req.method === 'POST') {
    const { id, restart } = JSON.parse(await readBody(req));
    const dl = store.downloads.get(id);
    if (!dl) {
      json(res, 400, { ok: false, error: 'دانلود یافت نشد' });
      return;
    }
    if (dl?.proc && process.platform !== 'win32') {
      dl.status = 'downloading';
      dl.proc.kill('SIGCONT');
      broadcast({ type: 'update', download: sanitize(dl) });
      json(res, 200, { ok: true, status: 'resumed' });
    } else if (dl?.status === 'paused') {
      const cfg = loadConfig();
      const folder = cfg.downloadFolder;
      const partFile = dl.filePath ? dl.filePath + '.part' : null;
      const hasPartFile = partFile && fs.existsSync(partFile);
      if (restart || !hasPartFile) {
        dl.status = 'queued';
        dl.progress = 0;
        dl.speed = '';
        dl.eta = '';
        startDownload(id);
        json(res, 200, { ok: true, status: 'restarted' });
      } else {
        startDownload(id);
        json(res, 200, { ok: true, status: 'resumed' });
      }
    } else {
      json(res, 400, { ok: false, error: 'دانلود برای ادامه یافت نشد یا وضعیت نامناسبی دارد' });
    }
    return;
  }

  // ── /api/remove ───────────────────────────────────────────────────────────
  if (pathname === '/api/remove' && req.method === 'POST') {
    const { id } = JSON.parse(await readBody(req));
    const dl = store.downloads.get(id);
    if (dl?.proc) {
      process.platform === 'win32'
        ? spawn('taskkill', ['/F', '/T', '/PID', dl.proc.pid], { windowsHide: true })
        : dl.proc.kill('SIGTERM');
    }
    store.downloads.delete(id);
    broadcast({ type: 'remove', id });
    json(res, 200, { ok: true });
    return;
  }

  // ── /api/config ───────────────────────────────────────────────────────────
  if (pathname === '/api/config') {
    if (req.method === 'GET')  return json(res, 200, loadConfig());
    if (req.method === 'POST') { saveConfig(JSON.parse(await readBody(req))); return json(res, 200, { ok: true }); }
  }

  // ── /api/proxy-test ───────────────────────────────────────────────────────
  if (pathname === '/api/proxy-test' && req.method === 'POST') {
    const { proxy } = JSON.parse(await readBody(req));
    if (!proxy) return json(res, 400, { ok: false, error: 'پروکسی وارد نشده' });
    try {
      const ip = await new Promise((resolve, reject) => {
        execFile('curl', ['-s', '--max-time', '12', '--proxy', proxy, 'https://api.ipify.org'],
          { timeout: 15000 }, (err, stdout) => {
            const t = (stdout || '').trim();
            (err || !t) ? reject(new Error('پروکسی پاسخ نداد')) : resolve(t);
          });
      });
      json(res, 200, { ok: true, ip });
    } catch (e) { json(res, 200, { ok: false, error: e.message }); }
    return;
  }

  // ── /api/open-folder ──────────────────────────────────────────────────────
  if (pathname === '/api/open-folder' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const cfg  = loadConfig();
    let target = cfg.downloadFolder;
    if (body.id) {
      const dl = store.downloads.get(body.id);
      if (dl?.filePath) target = path.dirname(dl.filePath);
    }
    if (!target || !fs.existsSync(target)) return json(res, 200, { ok: false, error: 'پوشه وجود ندارد' });
    const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [target], { detached: true, stdio: 'ignore' }).unref();
    json(res, 200, { ok: true });
    return;
  }

  // ── /api/admin/stats ──────────────────────────────────────────────────────
  if (pathname === '/api/admin/stats' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const allDl = Array.from(store.downloads.values()).map(sanitize);
    const uptimeSec = Math.floor((Date.now() - store.stats.startTime) / 1000);
    json(res, 200, {
      ok: true,
      stats: {
        ...store.stats,
        activeCount: allDl.filter(d => ['downloading', 'finalizing'].includes(d.status)).length,
        queuedCount: allDl.filter(d => d.status === 'queued').length,
        uptime:      `${Math.floor(uptimeSec/3600)}h ${Math.floor((uptimeSec%3600)/60)}m`,
        queue:       allDl.sort((a, b) => b.id - a.id),
      },
    });
    return;
  }

  // ── /api/admin/cancel ─────────────────────────────────────────────────────
  if (pathname === '/api/admin/cancel' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { id } = JSON.parse(await readBody(req));
    const dl = store.downloads.get(id);
    if (dl) {
      dl.status = 'cancelled';
      if (dl.proc) {
        process.platform === 'win32'
          ? spawn('taskkill', ['/F', '/T', '/PID', dl.proc.pid], { windowsHide: true })
          : dl.proc.kill('SIGTERM');
      }
      broadcast({ type: 'update', download: sanitize(dl) });
    }
    json(res, 200, { ok: true });
    return;
  }

  // ── /api/admin/update-ytdlp ───────────────────────────────────────────────
  if (pathname === '/api/admin/update-ytdlp' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    try {
      const { master } = JSON.parse(await readBody(req));
      if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR);
      const repo = master ? 'yt-dlp/yt-dlp-master-builds' : 'yt-dlp/yt-dlp';
      const url  = `https://github.com/${repo}/releases/latest/download/${YTDLP_BIN}`;
      const dest = path.join(BIN_DIR, YTDLP_BIN);
      
      await downloadFile(url, dest);
      const version = await ytdlpExec(['--version']);
      json(res, 200, { ok: true, version });
    } catch (e) { json(res, 500, { ok: false, error: e.message }); }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// Alias for startDownload to use store directly
const downloads = store.downloads;

server.listen(PORT, () => {
  console.log(`\n  ▶  VDL v1.0 running at  http://localhost:${PORT}`);
  console.log(`  Platform : ${process.platform}`);
  console.log(`  Config   : ${CONFIG_FILE}`);
  console.log(`  Admin pw : ${ADMIN_PASS}`);
  console.log(`  Dev mode : ${DEV_MODE}\n`);
});
