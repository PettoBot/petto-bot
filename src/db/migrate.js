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

async function applySchema({ connectionString, sslEnabled, label }) {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
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
  // The schema is applied by the instance that has the database; one that works through the bridge (or a worker) leaves it alone.
  if (!config.primaryDatabaseUrl || config.instanceRole === 'worker') {
    logger.info('Database schema: left to the main instance.'); // i18n-ignore: operator log
    return;
  }
  await applySchema({
    connectionString: config.primaryDatabaseUrl,
    sslEnabled: config.primaryDatabaseSsl,
    label: 'Discloud primary', // i18n-ignore: label for the log
  });
}

module.exports = { runMigrations };
