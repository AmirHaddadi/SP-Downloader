'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const YTDLP_BIN = os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_DIR = path.join(__dirname, '..', '..', 'bin');

function getYtdlpPath() {
  const localPath = path.join(BIN_DIR, YTDLP_BIN);
  return fs.existsSync(localPath) ? localPath : 'yt-dlp';
}

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

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
  return (b/1073741824).toFixed(2) + ' GB';
}

module.exports = {
  YTDLP_BIN,
  BIN_DIR,
  getYtdlpPath,
  downloadFile,
  ytdlpExec,
  formatBytes
};
