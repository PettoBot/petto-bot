const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Applies schema.sql via a direct Postgres connection. Safe to run on every
 * boot: every statement in schema.sql is `create table if not exists` /
 * `create or replace function`, so re-running it against an already-migrated
 * database is a no-op.
 *
 * Requires DATABASE_URL (a direct Postgres connection string, not the
 * Supabase REST/service_role key — PostgREST has no way to run DDL). If it's
 * not set, migrations are skipped and the schema must be applied by hand in
 * the Supabase SQL editor.
 */
async function runMigrations() {
  if (!config.databaseUrl) {
    logger.warn('DATABASE_URL not set — skipping automatic migrations. Apply src/db/schema.sql manually in the Supabase SQL editor.');
    return;
  }

  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const client = new Client({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);
    logger.info('Database schema is up to date.');
  } finally {
    await client.end();
  }
}

module.exports = { runMigrations };
