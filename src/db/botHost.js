const supabase = require('./supabase');
const { retryIdempotent } = require('../utils/transientDb');

async function upsertHost(uptimeSeconds, memoryMb, nodeVersion) {
  return retryIdempotent(async () => {
    const { error } = await supabase.from('bot_host').upsert({
      id: 1,
      uptime_seconds: uptimeSeconds,
      memory_mb: memoryMb,
      node_version: nodeVersion,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  });
}

module.exports = { upsertHost };
