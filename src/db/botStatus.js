const supabase = require('./supabase');
const { retryIdempotent } = require('../utils/transientDb');

async function upsertShardStatus(shardId, status, guildCount, pingMs) {
  return retryIdempotent(async () => {
    const { error } = await supabase.from('bot_status').upsert({
      shard_id: shardId,
      status,
      guild_count: guildCount,
      ping_ms: pingMs,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  });
}

module.exports = { upsertShardStatus };
