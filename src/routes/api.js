'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { ytdlpExec, downloadFile, YTDLP_BIN, BIN_DIR } = require('../utils/helpers');
const { loadConfig, saveConfig } = require('../services/config');
const { isDatabaseEnabled, pingDatabase } = require('../services/database');
const {
  store,
  broadcast,
  sanitize,
  startDownload,
  buildCommonArgs,
  createDownload,
  removeActiveDownload,
  emitDownloadUpdate,
  syncHistory,
} = require('../services/downloader');
const {
  listDownloadHistory,
  findDownloadHistory,
  removeDownloadHistory,
} = require('../models/download-history');
const { looksLikeFileUrl, probeUrl, detectParts } = require('../services/file-probe');

// Build the `meta` payload for a URL that points straight at a downloadable file
// (archive, installer, document, image…) rather than a media page. Multi-part
// archives (file.part1.rar, file.7z.001, file.z01…) are enumerated so the whole
// set downloads as one group.
async function buildFileMeta(url) {
  const info = await probeUrl(url);
  let parts = [];
  try { parts = await detectParts(url); } catch { parts = []; }

  const totalSize = parts.length
    ? parts.reduce((sum, p) => sum + (p.size || 0), 0)
    : (info.size || 0);

  return {
    kind:        'file',
    title:       info.fileName,
    fileName:    info.fileName,
    thumb:       '',
    duration:    0,
    uploader:    (() => { try { return new URL(url).hostname; } catch { return ''; } })(),
    extractor:   'direct',
    webpage_url: info.finalUrl || url,
    size:        totalSize,
    parts:       parts.map(p => ({ url: p.url, fileName: p.fileName, size: p.size })),
    videoQualities: [],
    audioQualities: [],
  };
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
  // Returned so callers can `return json(...)` to signal the request was handled.
  return true;
}

async function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', d => b += d);
    req.on('end', () => resolve(b));
  });
}

function sortByNewest(a, b) {
  return (b.timestamp || 0) - (a.timestamp || 0);
}

function serializeHistory(doc) {
  if (!doc) return null;
  return {
    ...doc,
    _id: doc._id ? String(doc._id) : undefined,
  };
}

function getActiveDownload({ id, sessionId }) {
  if (sessionId) {
    for (const dl of store.downloads.values()) {
      if (dl.sessionId === sessionId) return dl;
    }
  }

  if (Number.isInteger(id)) {
    return store.downloads.get(id) || null;
  }

  return null;
}

async function getAnyDownload(query) {
  const active = getActiveDownload(query);
  if (active) return active;

  if (query.sessionId) {
    return findDownloadHistory({ sessionId: query.sessionId });
  }

  if (Number.isInteger(query.id)) {
    return findDownloadHistory({ id: query.id });
  }

  return null;
}

function stopDownloadProcess(dl) {
  if (!dl?.proc) return;

  process.platform === 'win32'
    ? spawn('taskkill', ['/F', '/T', '/PID', dl.proc.pid], { windowsHide: true })
    : dl.proc.kill('SIGTERM');
}

async function handleApi(req, res, pathname, u) {
  if (pathname === '/api/downloads' && req.method === 'GET') {
    const active = Array.from(store.downloads.values())
      .map(sanitize)
      .sort(sortByNewest);
    const history = (await listDownloadHistory()).map(serializeHistory);
    json(res, 200, { ok: true, active, history });
    return true;
  }

  // ── /api/meta ─────────────────────────────────────────────────────────────
  if (pathname === '/api/meta' && req.method === 'POST') {
    try {
      const { url } = JSON.parse(await readBody(req));
      if (!url || !url.match(/^https?:\/\//i)) throw new Error('URL نامعتبر است');

      // Direct-file URLs (archives, installers, documents, images, fonts…) skip
      // yt-dlp entirely — probe the server for name/size and any sibling parts.
      if (looksLikeFileUrl(url)) {
        try {
          const meta = await buildFileMeta(url);
          json(res, 200, { ok: true, meta });
          return true;
        } catch {
          // Probe failed — fall through and let yt-dlp try as a media page.
        }
      }

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

      const meta = {
        title:          info.title       || 'Unknown',
        thumb:          info.thumbnail   || '',
        duration:       info.duration    || 0,
        uploader:       info.uploader    || info.channel || '',
        extractor:      info.extractor_key || info.ie_key || '',
        webpage_url:    info.webpage_url || url,
        videoQualities: videoQualities.length ? videoQualities : ['1080p','720p','480p','360p'],
        audioQualities: audioQualities.length ? audioQualities : ['320kbps','192kbps','128kbps','64kbps'],
      };
      json(res, 200, { ok: true, meta });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  // ── /api/download ─────────────────────────────────────────────────────────
  if (pathname === '/api/download' && req.method === 'POST') {
    try {
      const { url, title, thumb, format, quality, fileName, parts } = JSON.parse(await readBody(req));
      if (!url?.match(/^https?:\/\//i)) return json(res, 400, { ok: false, error: 'URL نامعتبر' });

      // Multi-part archive set → one grouped download per part, all sharing a groupId.
      if (format === 'file' && Array.isArray(parts) && parts.length > 1) {
        const groupId = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const created = parts
          .filter(p => p && /^https?:\/\//i.test(p.url))
          .map((p, i) => {
            const dl = createDownload({
              url: p.url, title: p.fileName || `${title || fileName} (${i + 1})`,
              thumb: '', format: 'file', fileName: p.fileName,
              partIndex: i + 1, partCount: parts.length, groupId,
            });
            return dl;
          });
        created.forEach(dl => startDownload(dl.id));
        return json(res, 200, { ok: true, groupId, ids: created.map(d => d.id), sessionIds: created.map(d => d.sessionId) });
      }

      const dl = createDownload({ url, title, thumb, format, quality, fileName });
      startDownload(dl.id);
      json(res, 200, { ok: true, id: dl.id, sessionId: dl.sessionId });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  // ── /api/retry ──────────────────────────────────────────────────────────────
  // Resume + repair an errored download in place. Reuses the original sessionId so
  // the same card resumes, and yt-dlp's --continue picks up the existing .part file
  // rather than starting over.
  if (pathname === '/api/retry' && req.method === 'POST') {
    try {
      const { id, sessionId } = JSON.parse(await readBody(req));

      // Still in memory (e.g. errored but not yet archived)? Restart it directly.
      const active = getActiveDownload({ id, sessionId });
      if (active) {
        active.skipHistory = false;
        stopDownloadProcess(active);
        startDownload(active.id);
        return json(res, 200, { ok: true, id: active.id, sessionId: active.sessionId });
      }

      // Otherwise revive it from history.
      const hist = await getAnyDownload({ id, sessionId });
      if (!hist) return json(res, 404, { ok: false, error: 'موردی برای تلاش مجدد پیدا نشد' });

      // Drop the stale error record first so it doesn't double-show; it'll be
      // re-archived when the retry finishes.
      if (hist.sessionId) {
        await removeDownloadHistory({ sessionId: hist.sessionId });
        broadcast({ type: 'history-remove', sessionId: hist.sessionId, id: null });
      }

      const dl = createDownload({
        url:       hist.url,
        title:     hist.title,
        thumb:     hist.thumb,
        format:    hist.format,
        quality:   hist.quality,
        fileName:  hist.fileName,
        partIndex: hist.partIndex,
        partCount: hist.partCount,
        groupId:   hist.groupId,
        sessionId: hist.sessionId,
      });
      startDownload(dl.id);
      json(res, 200, { ok: true, id: dl.id, sessionId: dl.sessionId });
    } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    return true;
  }

  // ── /api/download-file ────────────────────────────────────────────────────
  if (pathname === '/api/download-file' && req.method === 'GET') {
    const id = parseInt(u.searchParams.get('id'), 10);
    const sessionId = (u.searchParams.get('sessionId') || '').trim();
    const dl = await getAnyDownload({ id, sessionId });
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
    return true;
  }

  // ── /api/cancel ───────────────────────────────────────────────────────────
  if (pathname === '/api/cancel' && req.method === 'POST') {
    const { id, sessionId } = JSON.parse(await readBody(req));
    const dl = getActiveDownload({ id, sessionId });
    if (dl) {
      dl.status = 'cancelled';
      dl.completedAt = Date.now();
      if (dl.proc) {
        stopDownloadProcess(dl);
        emitDownloadUpdate(dl);
        await syncHistory(dl);
      } else {
        await syncHistory(dl);
        broadcast({ type: 'history-upsert', download: sanitize(dl) });
        removeActiveDownload(dl.id);
      }
    }
    json(res, 200, { ok: true });
    return true;
  }

  // ── /api/pause ────────────────────────────────────────────────────────────
  if (pathname === '/api/pause' && req.method === 'POST') {
    const { id, sessionId } = JSON.parse(await readBody(req));
    const dl = getActiveDownload({ id, sessionId });
    if (dl?.proc) {
      dl.status = 'paused';
      process.platform === 'win32'
        ? spawn('taskkill', ['/F', '/T', '/PID', dl.proc.pid], { windowsHide: true })
        : dl.proc.kill('SIGSTOP');
      if (process.platform === 'win32') dl.proc = null;
      emitDownloadUpdate(dl);
      await syncHistory(dl);
    }
    json(res, 200, { ok: true });
    return true;
  }

  // ── /api/resume ───────────────────────────────────────────────────────────
  if (pathname === '/api/resume' && req.method === 'POST') {
    const { id, sessionId } = JSON.parse(await readBody(req));
    const dl = getActiveDownload({ id, sessionId });
    if (dl?.proc && process.platform !== 'win32') {
      dl.status = 'downloading';
      dl.proc.kill('SIGCONT');
      emitDownloadUpdate(dl);
      await syncHistory(dl);
    } else if (dl?.status === 'paused') {
      startDownload(dl.id);
    }
    json(res, 200, { ok: true });
    return true;
  }

  // ── /api/remove ───────────────────────────────────────────────────────────
  if (pathname === '/api/remove' && req.method === 'POST') {
    const { id, sessionId } = JSON.parse(await readBody(req));
    const dl = getActiveDownload({ id, sessionId });

    if (dl) {
      dl.skipHistory = true;
      stopDownloadProcess(dl);
      removeActiveDownload(dl.id);
    }

    let removedHistory = false;
    if (sessionId) {
      removedHistory = await removeDownloadHistory({ sessionId });
    } else if (!dl && Number.isInteger(id)) {
      removedHistory = await removeDownloadHistory({ id });
    }

    if (removedHistory) {
      broadcast({ type: 'history-remove', sessionId: sessionId || null, id: Number.isInteger(id) ? id : null });
    }

    json(res, 200, { ok: true });
    return true;
  }

  // ── /api/config ───────────────────────────────────────────────────────────
  if (pathname === '/api/config') {
    if (req.method === 'GET')  { json(res, 200, loadConfig()); return true; }
    if (req.method === 'POST') { saveConfig(JSON.parse(await readBody(req))); json(res, 200, { ok: true }); return true; }
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
    return true;
  }

  // ── /api/open-folder ──────────────────────────────────────────────────────
  if (pathname === '/api/open-folder' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const cfg  = loadConfig();
    let target = cfg.downloadFolder;
    if (body.id || body.sessionId) {
      const dl = await getAnyDownload({ id: body.id, sessionId: body.sessionId });
      if (dl?.filePath) target = path.dirname(dl.filePath);
    }
    if (!target || !fs.existsSync(target)) return json(res, 200, { ok: false, error: 'پوشه وجود ندارد' });
    const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [target], { detached: true, stdio: 'ignore' }).unref();
    json(res, 200, { ok: true });
    return true;
  }

  // ── /api/status ───────────────────────────────────────────────────────────
  if (pathname === '/api/status' && req.method === 'GET') {
    const allDl = Array.from(store.downloads.values()).map(sanitize);
    const uptimeSec = Math.floor((Date.now() - store.stats.startTime) / 1000);
    const dbEnabled = isDatabaseEnabled();
    const dbConnected = dbEnabled ? await pingDatabase() : false;
    json(res, 200, {
      ok: true,
      stats: {
        ...store.stats,
        activeCount: allDl.filter(d => ['downloading', 'finalizing'].includes(d.status)).length,
        queuedCount: allDl.filter(d => d.status === 'queued').length,
        uptime:      `${Math.floor(uptimeSec/3600)}h ${Math.floor((uptimeSec%3600)/60)}m`,
      },
      db: { enabled: dbEnabled, connected: dbConnected },
    });
    return true;
  }

  // ── /api/update-ytdlp ──────────────────────────────────────────────────────
  if (pathname === '/api/update-ytdlp' && req.method === 'POST') {
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
    return true;
  }

  return false;
}

module.exports = {
  handleApi
};
