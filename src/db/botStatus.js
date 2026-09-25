const supabase = require('./supabase');
const { retryIdempotent } = require('../utils/transientDb');
const { mirrorStatus } = require('./statusMirror');

async function upsertShardStatus(shardId, status, guildCount, pingMs) {
  const row = {
    shard_id: shardId,
    status,
    guild_count: guildCount,
    ping_ms: pingMs,
    updated_at: new Date().toISOString(),
  };

  await retryIdempotent(async () => {
    const { error } = await supabase.from('bot_status').upsert(row, { onConflict: 'shard_id' });
    if (error) throw error;
  });

  await mirrorStatus('bot_status', row);
}

module.exports = { upsertShardStatus };
