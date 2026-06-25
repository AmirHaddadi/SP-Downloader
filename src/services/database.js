'use strict';

const { MongoClient } = require('mongodb');

const DEFAULT_DB_NAME = 'sp_downloader';
const DEFAULT_COLLECTION = 'download_history';

const state = {
  client: null,
  db: null,
  collection: null,
  ready: false,
  enabled: false,
};

function getMongoUri() {
  return (
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URL ||
    ''
  ).trim();
}

function getDatabaseName() {
  return (
    process.env.MONGODB_DB_NAME ||
    process.env.MONGO_DB_NAME ||
    DEFAULT_DB_NAME
  ).trim() || DEFAULT_DB_NAME;
}

function getCollectionName() {
  return (
    process.env.MONGODB_DOWNLOADS_COLLECTION ||
    process.env.MONGO_DOWNLOADS_COLLECTION ||
    DEFAULT_COLLECTION
  ).trim() || DEFAULT_COLLECTION;
}

async function initDatabase() {
  if (state.ready) return state;

  const uri = getMongoUri();
  state.enabled = Boolean(uri);

  if (!uri) {
    state.ready = true;
    return state;
  }

  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db(getDatabaseName());
  const collection = db.collection(getCollectionName());
  await collection.createIndex({ sessionId: 1 }, { unique: true });
  await collection.createIndex({ updatedAt: -1 });
  await collection.createIndex({ status: 1, updatedAt: -1 });

  state.client = client;
  state.db = db;
  state.collection = collection;
  state.ready = true;

  return state;
}

async function getHistoryCollection() {
  if (!state.ready) await initDatabase();
  return state.collection;
}

function isDatabaseEnabled() {
  return state.enabled;
}

module.exports = {
  initDatabase,
  getHistoryCollection,
  isDatabaseEnabled,
  getMongoUri,
  getDatabaseName,
  getCollectionName,
};
