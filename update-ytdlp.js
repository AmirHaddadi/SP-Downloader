const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const YTDLP_BIN = os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_DIR = path.join(__dirname, 'bin');
const YTDLP_PATH = path.join(BIN_DIR, YTDLP_BIN);

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error('Failed to download: ' + response.statusCode));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          if (os.platform() !== 'win32') {
            fs.chmodSync(dest, 0o755);
          }
          resolve();
        });
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function updateYtDlp() {
  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR);
  console.log('Downloading latest yt-dlp master build...');
  const url = `https://github.com/yt-dlp/yt-dlp-master-builds/releases/latest/download/${YTDLP_BIN}`;
  try {
    await downloadFile(url, YTDLP_PATH);
    console.log('yt-dlp updated to master build successfully at ' + YTDLP_PATH);
  } catch (err) {
    console.error('Update failed:', err);
  }
}

updateYtDlp();
