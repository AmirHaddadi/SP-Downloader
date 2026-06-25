'use strict';

const { getHistoryCollection } = require('../services/database');

const HISTORY_STATUSES = new Set(['done', 'error', 'cancelled']);

function normalizeDownload(download) {
  return {
    sessionId: download.sessionId,
    id: download.id,
    url: download.url || '',
    title: download.title || 'Unknown',
    thumb: download.thumb || '',
    format: download.format || 'video',
    quality: download.quality || '',
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

async function upsertDownloadHistory(download) {
  if (!download || !download.sessionId) return null;

  const collection = await getHistoryCollection();
  if (!collection) return null;

  const doc = normalizeDownload(download);
  await collection.updateOne(
    { sessionId: download.sessionId },
    {
      $set: doc,
      $setOnInsert: { createdAt: new Date(doc.timestamp || Date.now()) },
    },
    { upsert: true }
  );
  return doc;
}

async function listDownloadHistory(limit = 200) {
  const collection = await getHistoryCollection();
  if (!collection) return [];

  return collection
    .find({ status: { $in: Array.from(HISTORY_STATUSES) } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
}

async function findDownloadHistory(query) {
  const collection = await getHistoryCollection();
  if (!collection) return null;
  return collection.findOne(query);
}

async function removeDownloadHistory(query) {
  const collection = await getHistoryCollection();
  if (!collection || !query) return false;
  const result = await collection.deleteOne(query);
  return result.deletedCount > 0;
}

module.exports = {
  HISTORY_STATUSES,
  upsertDownloadHistory,
  listDownloadHistory,
  findDownloadHistory,
  removeDownloadHistory,
};
