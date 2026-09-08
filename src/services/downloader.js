'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { getYtdlpPath } = require('../utils/helpers');
const { loadConfig } = require('./config');
const { upsertDownloadHistory, HISTORY_STATUSES } = require('../models/download-history');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'finalizing', 'paused']);

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Strip characters that are illegal in filenames across Windows/macOS/Linux.
function sanitizeFileName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200) || 'file';
}

function isYoutubeUrl(url) {
  const host = hostnameOf(url);
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
}

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

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of store.sseClients.values()) res.write(msg);
}

function buildCommonArgs(cfg, url) {
  const c = cfg || loadConfig();
  const args = [
    '--user-agent', USER_AGENT,
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
    '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '--socket-timeout', '60',
    '--retries', '10',
    '--fragment-retries', '10',
    '--retry-sleep', '3',
    '--no-abort-on-error',
    '--geo-bypass',
    '--no-check-certificates',
  ];
  // Many extractors gate content behind a one-click "I am over 18" interstitial.
  // yt-dlp clears that itself; --age-limit tells it not to skip such entries.
  args.push('--age-limit', '99', '--prefer-free-formats');
  const hasCookies = (c.cookiesFrom && c.cookiesFrom !== 'none') || (c.cookiesFile && fs.existsSync(c.cookiesFile));
  if (c.cookiesFrom && c.cookiesFrom !== 'none') args.push('--cookies-from-browser', c.cookiesFrom);
  if (c.cookiesFile && fs.existsSync(c.cookiesFile))  args.push('--cookies', c.cookiesFile);
  // Without cookies, YouTube frequently throws "Sign in to confirm you're not a bot"
  // on the default web client. The android/tv embedded clients don't require that
  // check for most public videos, so try them first and only fall back to web.
  if (isYoutubeUrl(url) && !hasCookies) {
    args.push('--extractor-args', 'youtube:player_client=android,tv,web');
  }
  if (c.proxy) args.push('--proxy', c.proxy);
  return args;
}

function sanitize(dl) {
  const { proc, skipHistory, ...rest } = dl;
  return rest;
}

function createSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

function isHistoryStatus(status) {
  return HISTORY_STATUSES.has(status);
}

async function syncHistory(download) {
  try {
    await upsertDownloadHistory(sanitize(download));
  } catch (error) {
    console.error('History sync failed:', error.message);
  }
}

function emitDownloadUpdate(download) {
  broadcast({ type: 'update', download: sanitize(download) });
}

async function archiveDownload(download) {
  await syncHistory(download);
  broadcast({ type: 'history-upsert', download: sanitize(download) });
}

function removeActiveDownload(id) {
  const dl = store.downloads.get(id);
  if (!dl) return null;
  store.downloads.delete(id);
  broadcast({ type: 'remove', id, sessionId: dl.sessionId });
  return dl;
}

function createDownload(payload) {
  const id = store.nextId++;
  const dl = {
    id,
    sessionId: payload.sessionId || createSessionId(),
    url: payload.url,
    title: payload.title || 'Unknown',
    thumb: payload.thumb || '',
    format: payload.format || 'video',
    quality: payload.quality || '',
    fileName: payload.fileName || '',
    partIndex: payload.partIndex || 0,
    partCount: payload.partCount || 0,
    groupId: payload.groupId || '',
    status: 'queued',
    progress: 0,
    speed: '',
    eta: '',
    filePath: '',
    errorMsg: '',
    totalBytes: 0,
    logs: [],
    timestamp: Date.now(),
    startTime: null,
    completedAt: null,
  };

  store.downloads.set(id, dl);
  emitDownloadUpdate(dl);
  void syncHistory(dl);
  return dl;
}

function startDownload(id) {
  const dl = store.downloads.get(id);
  if (!dl) return;

  const cfg        = loadConfig();
  const today      = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const typeDir    = dl.format === 'audio' ? 'Music' : dl.format === 'file' ? 'Files' : 'Video';
  const folder     = cfg.organizeByType !== false
    ? path.join(cfg.downloadFolder, typeDir, today)
    : cfg.downloadFolder;
  fs.mkdirSync(folder, { recursive: true });

  // For a direct file (archive, document, image, installer…) keep the server's
  // real filename; otherwise let yt-dlp template the media title.
  const outTemplate = dl.format === 'file' && dl.fileName
    ? path.join(folder, sanitizeFileName(dl.fileName))
    : path.join(folder, '%(title).100s.%(ext)s');

  const args = [
    '--no-playlist', '--newline', '--progress',
    '--continue', // resume/repair partial .part files instead of restarting
    ...buildCommonArgs(cfg, dl.url),
    '-o', outTemplate,
  ];

  if (dl.format === 'audio') {
    const abr = dl.quality ? dl.quality.replace('kbps', '') : '128';
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', abr, '--no-keep-video');
  } else if (dl.format === 'file') {
    // Direct HTTP download — no format selection, no post-processing.
    args.push('--no-check-formats');
  } else {
    const height = dl.quality ? dl.quality.replace('p', '') : '480';
    args.push(
      '-f', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`,
      '--merge-output-format', 'mp4'
    );
  }
  args.push(dl.url);

  Object.assign(dl, { 
    status: 'downloading', 
    progress: 0, 
    speed: '', 
    eta: '', 
    errorMsg: '', 
    startTime: Date.now(),
    logs: [] 
  });
  
  const addLog = (msg, type = 'info') => {
    const entry = { msg, type, time: new Date().toLocaleTimeString('fa-IR') };
    dl.logs = (dl.logs || []).slice(-30); // Increased buffer
    dl.logs.push(entry);
    broadcast({ type: 'log', id: dl.id, sessionId: dl.sessionId, entry });
  };

  addLog('آماده‌سازی برای دریافت...', 'info');
  emitDownloadUpdate(dl);
  void syncHistory(dl);

  const proc = spawn(getYtdlpPath(), args, { windowsHide: true });
  dl.proc = proc;
  let stderrBuf = '';
  let lastLogPercent = -5; // Only log every 10% to keep it clean
  let lastPersistBucket = -1;

  proc.stdout.on('data', chunk => {
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\S+)\s+at\s+([\d.]+\s*\S+\/s)\s+ETA\s+(\S+)/);
      if (m) {
        const percent = parseFloat(m[1]);
        const totalSize = m[2];
        const speed = m[3];
        const eta = m[4];
        
        dl.progress = percent;
        dl.speed = speed;
        dl.eta = eta;

        // Linear logging for details
        if (percent >= lastLogPercent + 10 || percent >= 99) {
          lastLogPercent = Math.floor(percent / 10) * 10;
          const elapsedSec = Math.floor((Date.now() - dl.startTime) / 1000);
          const uptime = `${Math.floor(elapsedSec/60)}m ${elapsedSec%60}s`;
          
          // Calculate downloaded and remaining (approximate)
          addLog(`پیشرفت: ${percent}% | سرعت: ${speed} | زمان سپری شده: ${uptime} | باقی‌مانده: ${eta}`, 'info');
        }

        if (dl.progress >= 100) dl.status = 'finalizing';
        emitDownloadUpdate(dl);

        const progressBucket = Math.floor(percent / 25);
        if (progressBucket > lastPersistBucket) {
          lastPersistBucket = progressBucket;
          void syncHistory(dl);
        }
      }
      
      const dm = line.match(/\[(?:download|Merger|ffmpeg)\] Destination: (.+)/);
      if (dm) {
        dl.filePath = dm[1].trim();
        addLog(`ذخیره در: ${path.basename(dl.filePath)}`, 'success');
      }

      const sm = line.match(/of\s+~?\s*([\d.]+)(KiB|MiB|GiB)/i);
      if (sm && !dl.totalBytes) {
        const v = parseFloat(sm[1]), u = sm[2].toUpperCase();
        dl.totalBytes = u === 'GIB' ? v * 1073741824 : u === 'MIB' ? v * 1048576 : v * 1024;
        addLog(`حجم تخمینی: ${(v).toFixed(1)} ${u}`, 'info');
      }

      // Capture ffmpeg or merger steps
      if (line.includes('[Merger]')) addLog('در حال ترکیب فایل‌های ویدئو و صدا...', 'info');
      if (line.includes('[ffmpeg]')) addLog('پردازش توسط ffmpeg...', 'info');
    }
  });

  proc.stderr.on('data', chunk => { 
    const text = chunk.toString();
    stderrBuf += text;
    // Extract errors for logs
    if (text.includes('ERROR:')) {
      const err = text.split('ERROR:')[1].split('\n')[0].trim();
      addLog(err, 'error');
    }
    if (text.includes('warning:')) {
      const warn = text.split('warning:')[1].split('\n')[0].trim();
      addLog(warn, 'info');
    }
  });

  proc.on('close', code => {
    dl.proc = null;
    if (dl.skipHistory) return;

    if (code === 0) {
      addLog('دانلود با موفقیت تکمیل شد ✅', 'success');
      Object.assign(dl, { status: 'done', progress: 100, speed: '', eta: '', completedAt: Date.now() });
      store.stats.totalDownloads++;
      if (dl.totalBytes) store.stats.totalBytes += dl.totalBytes;
    } else if (!['paused', 'cancelled'].includes(dl.status)) {
      dl.status = 'error';
      dl.completedAt = Date.now();
      store.stats.errors++;
      const errLine = stderrBuf.split('\n').filter(l => l.includes('ERROR:') || l.includes('Postprocessing')).pop() || '';
      dl.errorMsg = errLine.replace(/^.*(?:ERROR|Postprocessing):\s*/, '').trim().substring(0, 150);
      if (/No video formats found|Unsupported URL|Requested format is not available/i.test(dl.errorMsg)) {
        dl.errorMsg = 'منبع پاسخ نداد یا فرمت در دسترس نیست. کوکی مرورگر را در تنظیمات فعال کن و هسته را از بخش «وضعیت» به‌روزرسانی کن.';
      }
      if (/Sign in to confirm|not a bot/i.test(dl.errorMsg)) {
        dl.errorMsg = 'منبع درخواست تایید هویت کرده. از بخش تنظیمات، کوکی مرورگری که در آن لاگین هستی را انتخاب کن و دوباره تلاش کن.';
      }
      if (/ffmpeg|ffprobe/i.test(dl.errorMsg)) {
        dl.errorMsg = 'ffmpeg نصب نیست. راهنمای نصب در README پروژه.';
      }
      addLog(`خطا در عملیات: ${dl.errorMsg}`, 'error');
    }

    if (isHistoryStatus(dl.status)) {
      if (!dl.completedAt) dl.completedAt = Date.now();
      void archiveDownload(dl).finally(() => {
        removeActiveDownload(id);
      });
      return;
    }

    emitDownloadUpdate(dl);
    void syncHistory(dl);
  });
}

module.exports = {
  store,
  broadcast,
  buildCommonArgs,
  sanitize,
  createDownload,
  removeActiveDownload,
  emitDownloadUpdate,
  syncHistory,
  isActiveStatus,
  isHistoryStatus,
  sanitizeFileName,
  startDownload,
  USER_AGENT
};
