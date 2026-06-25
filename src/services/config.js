'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = path.join(os.homedir(), '.vdl_config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch {
    return {
      downloadFolder: path.join(os.homedir(), 'Downloads', 'SP-Downloader'),
      cookiesFrom:    'none',
      cookiesFile:    '',
      proxy:          '',
      organizeByType: true,
    };
  }
}

function saveConfig(cfg) {
  // Merge over the existing config so fields not present in the incoming
  // payload (e.g. cookie settings no longer exposed in the UI) are preserved
  // rather than silently wiped — the downloader still reads them from disk.
  const merged = { ...loadConfig(), ...cfg };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

module.exports = {
  loadConfig,
  saveConfig,
  CONFIG_FILE
};
