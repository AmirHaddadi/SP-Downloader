'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getHistoryCollection } = require('../services/database');

const HISTORY_STATUSES = new Set(['done', 'error', 'cancelled']);

// When no MongoDB is configured the history still needs to survive restarts, so
// it falls back to a small JSON file in the user's home directory. This keeps
// the project zero-dependency to try — Mongo is a scaling choice, not a
// requirement.
const FILE_STORE_PATH = path.join(os.homedir(), '.vdl_history.json');
const FILE_STORE_LIMIT = 500;

function normalizeDownload(download) {
  return {
    sessionId: download.sessionId,
    id: download.id,
    url: download.url || '',
    title: download.title || 'Unknown',
    thumb: download.thumb || '',
    format: download.format || 'video',
    quality: download.quality || '',
    fileName: download.fileName || '',
    partIndex: Number(download.partIndex || 0),
    partCount: Number(download.partCount || 0),
    groupId: download.groupId || '',
    status: download.status || 'queued',
    progress: Number(download.progress || 0),
    speed: download.speed || '',
    eta: download.eta || '',
    filePath: download.filePath || '',
    errorMsg: download.errorMsg || '',
    totalBytes: Number(download.totalBytes || 0),
    timestamp: download.timestamp || Date.now(),
    startTime: download.startTime || null,
    completedAt: HISTORY_STATUSES.has(download.status) ? (download.completedAt || Date.now()) : null,
    logs: Array.isArray(download.logs) ? download.logs.slice(-30) : [],
    updatedAt: new Date(),
  };
}

/* ── JSON file fallback ──────────────────────────────────────────────────── */
function readFileStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE_STORE_PATH, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeFileStore(rows) {
  try {
    const trimmed = rows
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      .slice(0, FILE_STORE_LIMIT);
    fs.writeFileSync(FILE_STORE_PATH, JSON.stringify(trimmed, null, 0));
  } catch (error) {
    console.error('History file write failed:', error.message);
  }
}

function fileMatches(row, query) {
  return Object.entries(query || {}).every(([key, value]) => row[key] === value);
}

/* ── Public API (Mongo when available, JSON file otherwise) ──────────────── */
async function upsertDownloadHistory(download) {
  if (!download || !download.sessionId) return null;
  const doc = normalizeDownload(download);

  const collection = await getHistoryCollection();
  if (collection) {
    await collection.updateOne(
      { sessionId: download.sessionId },
      { $set: doc, $setOnInsert: { createdAt: new Date(doc.timestamp || Date.now()) } },
      { upsert: true }
    );
    return doc;
  }

  const rows = readFileStore();
  const idx = rows.findIndex(r => r.sessionId === download.sessionId);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...doc };
  else rows.push({ ...doc, createdAt: new Date(doc.timestamp || Date.now()) });
  writeFileStore(rows);
  return doc;
}

async function listDownloadHistory(limit = 200) {
  const collection = await getHistoryCollection();
  if (collection) {
    return collection
      .find({ status: { $in: Array.from(HISTORY_STATUSES) } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
  }

  return readFileStore()
    .filter(r => HISTORY_STATUSES.has(r.status))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, limit);
}

async function findDownloadHistory(query) {
  const collection = await getHistoryCollection();
  if (collection) return collection.findOne(query);
  return readFileStore().find(r => fileMatches(r, query)) || null;
}

async function removeDownloadHistory(query) {
  if (!query) return false;
  const collection = await getHistoryCollection();
  if (collection) {
    const result = await collection.deleteOne(query);
    return result.deletedCount > 0;
  }

  const rows = readFileStore();
  const kept = rows.filter(r => !fileMatches(r, query));
  if (kept.length === rows.length) return false;
  writeFileStore(kept);
  return true;
}

module.exports = {
  HISTORY_STATUSES,
  upsertDownloadHistory,
  listDownloadHistory,
  findDownloadHistory,
  removeDownloadHistory,
};
