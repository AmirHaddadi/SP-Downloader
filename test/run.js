'use strict';

/*
 * SP Downloader test suite — syntax validation + end-to-end API checks.
 * No browser / visual testing. Run with `npm test`.
 */

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => { failures++; console.error(`  ✗ ${name}\n      ${detail}`); };

function assert(cond, name, detail = '') {
  cond ? ok(name) : bad(name, detail || 'assertion failed');
}

/* ── 1. Syntax validation ───────────────────────────────────────────────── */
function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'bin'].includes(entry.name)) continue;
      out.push(...walkJs(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

console.log('\nSyntax validation');
for (const file of [
  ...walkJs(path.join(ROOT, 'src')),
  ...walkJs(path.join(ROOT, 'public')),
  ...walkJs(path.join(ROOT, 'test')),
  path.join(ROOT, 'update-ytdlp.js'),
]) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    ok(path.relative(ROOT, file));
  } catch (e) {
    bad(path.relative(ROOT, file), String(e.stderr || e.message).trim());
  }
}

/* ── 2. file-probe pure logic ───────────────────────────────────────────── */
console.log('\nfile-probe logic');
const probe = require('../src/services/file-probe');
assert(probe.looksLikeFileUrl('https://example.com/pack/archive.zip'), 'detects .zip as a file');
assert(probe.looksLikeFileUrl('https://example.com/setup.7z.001'), 'detects .7z.001 split as a file');
assert(!probe.looksLikeFileUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'ignores a YouTube watch URL');
assert(!probe.looksLikeFileUrl('https://vimeo.com/12345'), 'ignores a Vimeo page URL');
const pattern = probe.parsePartPattern('https://example.com/f/movie.part03.rar');
assert(pattern && pattern.num === 3 && pattern.pad === 2, 'parses movie.part03.rar → num 3, pad 2');
assert(pattern && pattern.build(1) === 'https://example.com/f/movie.part01.rar', 'rebuilds sibling part URL');
assert(probe.parsePartPattern('https://example.com/plain.rar') === null, 'single .rar is not a part set');

/* ── 3. End-to-end API ──────────────────────────────────────────────────── */
(async () => {
  console.log('\nEnd-to-end API');
  const PORT = 40000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), MONGODB_URI: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });

  const base = `http://localhost:${PORT}`;
  const waitForUp = async () => {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${base}/api/status`); return true; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    return false;
  };

  try {
    if (!await waitForUp()) { bad('server boots', serverLog.trim()); return; }
    ok('server boots (no MongoDB)');

    const idx = await fetch(`${base}/`);
    assert(idx.status === 200 && (await idx.text()).includes('<title'), 'GET / serves the app shell');

    const cfg = await (await fetch(`${base}/api/config`)).json();
    assert(typeof cfg.downloadFolder === 'string', 'GET /api/config returns a config object');

    const dls = await (await fetch(`${base}/api/downloads`)).json();
    assert(dls.ok === true && Array.isArray(dls.active) && Array.isArray(dls.history),
      'GET /api/downloads returns { ok, active[], history[] }');

    const badMeta = await (await fetch(`${base}/api/meta`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    })).json();
    assert(badMeta.ok === false, 'POST /api/meta rejects an invalid URL');

    const badDl = await (await fetch(`${base}/api/download`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'ftp://nope' }),
    })).json();
    assert(badDl.ok === false, 'POST /api/download rejects a non-http(s) URL');

    const status = await (await fetch(`${base}/api/status`)).json();
    assert(status.ok === true && status.db && status.db.enabled === false,
      'GET /api/status reports MongoDB disabled');
  } catch (e) {
    bad('end-to-end run', `${e.message}\n--- server log ---\n${serverLog.trim()}`);
  } finally {
    server.kill('SIGTERM');
  }

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
