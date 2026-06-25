'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { ytdlpExec, downloadFile, YTDLP_BIN, BIN_DIR } = require('../utils/helpers');
const { loadConfig, saveConfig } = require('../services/config');
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

const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

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
      const { url, title, thumb, format, quality } = JSON.parse(await readBody(req));
      if (!url?.match(/^https?:\/\//i)) return json(res, 400, { ok: false, error: 'URL نامعتبر' });
      const dl = createDownload({ url, title, thumb, format, quality });
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

  // ── /api/admin/stats ──────────────────────────────────────────────────────
  if (pathname === '/api/admin/stats' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return true;
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
    return true;
  }

  // ── /api/admin/cancel ─────────────────────────────────────────────────────
  if (pathname === '/api/admin/cancel' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return true;
    const { id } = JSON.parse(await readBody(req));
    const dl = getActiveDownload({ id });
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

  // ── /api/admin/update-ytdlp ───────────────────────────────────────────────
  if (pathname === '/api/admin/update-ytdlp' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return true;
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
