// i18n-ignore-file: SQL and database plumbing, no text anybody reads
// The second database (PETTO_DATA2_DATABASE_URL) for the heavy data that is only copies or can be rebuilt (today the public threat lists; the avatar
// copies of the profile history were kept here until the avatar history was removed). Without it these tables stay in the main database, exactly as before. The tables are made in the second database
// the first time it is used, and what the main database already has is moved over in the background (jobs/dataMoveJob.js).
const { Pool } = require('pg');
const config = require('../config');
const { getPrimaryPool, createPostgresClient } = require('./postgres');

const SCHEMA = `
  create table if not exists malicious_links (
    normalized_url        text primary key,
    hostname              text not null,
    threat_types          text[] not null default '{}'::text[],
    source                text not null default 'public_threat_feeds',
    reported_by           text,
    first_seen_guild_id   text,
    first_seen_channel_id text,
    first_seen_at         timestamptz not null default now(),
    last_checked_at       timestamptz not null default now(),
    dev_alerted_at        timestamptz
  );
  create index if not exists malicious_links_hostname_idx on malicious_links (hostname);
`;

let dedicated;
let schemaReady;

/** True when there is a second database (the data is not in the main one). */
const isSeparate = () => Boolean(config.data2DatabaseUrl);

function rawPool() {
  if (!isSeparate()) return getPrimaryPool();
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
  if (!isSeparate()) return Promise.resolve();
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

module.exports = { isSeparate, pool, database, ready, closeSecondary, SCHEMA };
