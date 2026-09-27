const database = require('./database');
const { retryIdempotent } = require('../utils/transientDb');

async function upsertShardStatus(shardId, status, guildCount, pingMs) {
  const row = {
    shard_id: shardId,
    status,
    guild_count: guildCount,
    ping_ms: pingMs,
    updated_at: new Date().toISOString(),
  };

  await retryIdempotent(async () => {
    const { error } = await database.from('bot_status').upsert(row, { onConflict: 'shard_id' });
    if (error) throw error;
  });
}

module.exports = { upsertShardStatus };
