const config = require('../config');
const { createPostgresClient, getMirrorPool } = require('./postgres');
const { retryIdempotent } = require('../utils/transientDb');
const logger = require('../utils/logger');

const mirror = config.primaryDatabaseUrl && config.supabaseDatabaseUrl
  ? createPostgresClient(getMirrorPool())
  : null;

async function mirrorRow(table, row, onConflict) {
  if (!mirror) return;

  try {
    await retryIdempotent(async () => {
      const { error } = await mirror.from(table).upsert(row, { onConflict });
      if (error) throw error;
    });
  } catch (error) {
    logger.warn(`Database mirror write failed for ${table}:`, error);
  }
}

async function mirrorStatus(table, row) {
  const onConflict = table === 'bot_status' ? 'shard_id' : 'id';
  return mirrorRow(table, row, onConflict);
}

async function mirrorActivity(row) {
  return mirrorRow('activity_stats', row, 'guild_id,channel_id,day');
}

function hasMirror() {
  return Boolean(mirror);
}

module.exports = { mirrorStatus, mirrorActivity, hasMirror };
