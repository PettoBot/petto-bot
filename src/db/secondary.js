// i18n-ignore-file: SQL and database plumbing, no text anybody reads
// The second database (PETTO_DATA2_DATABASE_URL). Nothing is kept in it for now: the public threat lists that were here are gone (Google Safe Browsing
// is the link check, and what it flags is a few rows in the main database), so no table is made in it and nothing reads or writes it. It stays free
// for when the main database is split in two (see docs/REFERENCE.md). `scripts/purge-avatar-history.js` can still look at it for the old avatar copies.
const { Pool } = require('pg');
const config = require('../config');
const { getPrimaryPool, createPostgresClient } = require('./postgres');

// No tables: the second database is left as it is. When some data moves here again, its `create table if not exists` goes in this text.
const SCHEMA = '';

let dedicated;
let schemaReady;

/** True when there is a second database (the data is not in the main one). */
const isSeparate = () => Boolean(config.data2DatabaseUrl) || require('./bridgeTargets').has('data2');

function rawPool() {
  if (!isSeparate()) return getPrimaryPool();
  if (!config.data2DatabaseUrl) return require('./bridgeTargets').poolFor('data2'); // through the SQL bridge of the primary
  if (!dedicated) {
    const url = new URL(config.data2DatabaseUrl);
    url.searchParams.delete('sslmode'); // pg would override the ssl option below with it
    dedicated = new Pool({ connectionString: url.toString(), ssl: config.data2DatabaseSsl ? { rejectUnauthorized: false } : false, max: 4, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30_000 });
    dedicated.on('error', () => {});
  }
  return dedicated;
}

/** Makes the tables of the second database once (nothing to do when there is none). */
function ready() {
  if (!isSeparate() || !SCHEMA.trim()) return Promise.resolve();
  if (!schemaReady) schemaReady = rawPool().query(SCHEMA).catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

/** A pool for the heavy data: the second database (with its tables made) or, without one, the main database. */
const pool = {
  async query(...args) { await ready(); return rawPool().query(...args); },
  async connect() { await ready(); return rawPool().connect(); },
};

/** The query client (`from(...).select()...`) of the heavy tables. */
const database = createPostgresClient(pool, { announce: false });

const closeSecondary = async () => { if (dedicated) { await dedicated.end().catch(() => {}); dedicated = null; schemaReady = null; } };

module.exports = { rawPool, isSeparate, pool, database, ready, closeSecondary, SCHEMA };
