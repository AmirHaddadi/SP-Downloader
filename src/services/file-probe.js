'use strict';

const http = require('http');
const https = require('https');
const path = require('path');

const MAX_REDIRECTS = 5;
const MAX_PARTS = 50;
const PROBE_TIMEOUT = 15000;

// Extensions that mark a URL as a "direct file" (non-media handled by yt-dlp).
const FILE_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img',
  'exe', 'msi', 'apk', 'dmg', 'pkg', 'deb', 'rpm', 'appimage',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'epub',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'psd',
  'ttf', 'otf', 'woff', 'woff2',
  'srt', 'ass', 'json', 'xml', 'sql', 'bak', 'bin', 'dat',
]);

function urlPathname(url) {
  try { return decodeURIComponent(new URL(url).pathname); }
  catch { return ''; }
}

function fileNameFromUrl(url) {
  const base = path.posix.basename(urlPathname(url));
  return base || 'file';
}

// Multi-part naming patterns. Each returns { prefix, num, suffix, pad } so we
// can rebuild sibling part URLs by swapping the number.
const PART_PATTERNS = [
  /^(.*\.part)(\d+)(\.[a-z0-9]{1,5})$/i,   // file.part1.rar / file.part01.rar
  /^(.*[._-]part[._-]?)(\d+)()$/i,         // file-part1 / file_part_2
  /^(.*\.)(\d{3})()$/,                     // file.7z.001 / file.001
  /^(.*\.z)(\d{2})()$/i,                   // file.z01 (zip split)
  /^(.*\.r)(\d{2})()$/i,                   // file.r00 (old rar split)
];

function parsePartPattern(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const name = path.posix.basename(u.pathname);
  for (const re of PART_PATTERNS) {
    const m = name.match(re);
    if (!m) continue;
    const dir = u.pathname.slice(0, u.pathname.length - name.length);
    return {
      num: parseInt(m[2], 10),
      pad: m[2].length,
      // .r00/.z01 sets start at 0/1 respectively; generic sets start at 1
      first: /\.r$/i.test(m[1]) ? 0 : 1,
      build(i) {
        const n = String(i).padStart(this.pad, '0');
        const clone = new URL(u.href);
        // `name` comes from u.pathname, so it's already percent-encoded — no re-encoding.
        clone.pathname = dir + m[1] + n + m[3];
        return clone.href;
      },
    };
  }
  return null;
}

function looksLikeFileUrl(url) {
  const name = fileNameFromUrl(url).toLowerCase();
  if (parsePartPattern(url)) return true;
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return FILE_EXTENSIONS.has(ext);
}

function requestHead(url, { method = 'HEAD', redirects = 0, proxyAgnostic = true } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('URL نامعتبر است')); }
    const lib = parsed.protocol === 'http:' ? http : https;

    const req = lib.request(parsed, {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}),
      },
      timeout: PROBE_TIMEOUT,
      rejectUnauthorized: false,
    }, res => {
      res.resume(); // discard any body
      const { statusCode, headers } = res;
      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location && redirects < MAX_REDIRECTS) {
        const next = new URL(headers.location, url).href;
        return resolve(requestHead(next, { method, redirects: redirects + 1 }));
      }
      // Some servers reject HEAD — retry once with a 1-byte GET.
      if (method === 'HEAD' && statusCode >= 400) {
        return resolve(requestHead(url, { method: 'GET', redirects }));
      }
      if (statusCode >= 400) return reject(new Error(`سرور پاسخ داد: ${statusCode}`));

      let size = 0;
      if (statusCode === 206 && headers['content-range']) {
        const m = String(headers['content-range']).match(/\/(\d+)/);
        if (m) size = parseInt(m[1], 10);
      } else if (headers['content-length']) {
        size = parseInt(headers['content-length'], 10) || 0;
      }

      let fileName = '';
      const cd = headers['content-disposition'] || '';
      const cdm = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
      if (cdm) { try { fileName = decodeURIComponent(cdm[1].trim()); } catch { fileName = cdm[1].trim(); } }

      resolve({
        ok: true,
        finalUrl: url,
        size,
        contentType: (headers['content-type'] || '').split(';')[0].trim(),
        acceptRanges: statusCode === 206 || /bytes/i.test(headers['accept-ranges'] || ''),
        fileName: fileName || fileNameFromUrl(url),
      });
    });

    req.on('timeout', () => { req.destroy(new Error('پاسخی از سرور دریافت نشد')); });
    req.on('error', err => reject(err));
    req.end();
  });
}

async function probeUrl(url) {
  return requestHead(url);
}

// Given any part of a multi-part set, enumerate siblings by probing sequential
// numbers until the first miss. Returns [] when the URL isn't part-like or
// only one part actually exists.
async function detectParts(url) {
  const pattern = parsePartPattern(url);
  if (!pattern) return [];

  const parts = [];
  for (let i = pattern.first; i < pattern.first + MAX_PARTS; i++) {
    const partUrl = pattern.build(i);
    try {
      const info = await requestHead(partUrl);
      parts.push({ url: partUrl, fileName: info.fileName, size: info.size });
    } catch {
      if (i <= pattern.first) return []; // even the first part is missing → not a real set
      break;
    }
  }
  return parts.length > 1 ? parts : [];
}

module.exports = {
  looksLikeFileUrl,
  parsePartPattern,
  probeUrl,
  detectParts,
  fileNameFromUrl,
  FILE_EXTENSIONS,
};
