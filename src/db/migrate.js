const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function normalizeConnectionString(connectionString, sslEnabled) {
  if (sslEnabled) return connectionString;
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString;
  }
}

function schemaForTarget(sql, isSupabase) {
  if (isSupabase) return sql;
  // These policies are for Supabase's anon REST role. A standalone Discloud
  // PostgreSQL instance does not define that role, so leaving them in would
  // make an otherwise valid schema fail during startup.
  return sql.split('\n').filter((line) => !/^\s*create policy\s+"bot_(status|host)_public_read"/i.test(line)).join('\n');
}

async function applySchema({ connectionString, sslEnabled, label, isSupabase }) {
  const sql = schemaForTarget(fs.readFileSync(SCHEMA_PATH, 'utf8'), isSupabase);
  const client = new Client({
    connectionString: normalizeConnectionString(connectionString, sslEnabled),
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
  });

  await client.connect();
  try {
    await client.query(sql);
    logger.info(`Database schema is up to date (${label}).`);
  } finally {
    await client.end();
  }
}

/**
 * Applies schema.sql only to Petto's Discloud PostgreSQL database.
 */
async function runMigrations() {
  await applySchema({
    connectionString: config.primaryDatabaseUrl,
    sslEnabled: config.primaryDatabaseSsl,
    label: 'Discloud primary',
    isSupabase: false,
  });
}

module.exports = { runMigrations };
