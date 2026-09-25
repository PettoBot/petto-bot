const supabase = require('./supabase');
const { retryIdempotent } = require('../utils/transientDb');
const { mirrorStatus } = require('./statusMirror');

async function upsertHost(uptimeSeconds, memoryMb, nodeVersion) {
  const row = {
      id: 1,
      uptime_seconds: uptimeSeconds,
      memory_mb: memoryMb,
      node_version: nodeVersion,
      updated_at: new Date().toISOString(),
  };

  await retryIdempotent(async () => {
    const { error } = await supabase.from('bot_host').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  });

  await mirrorStatus('bot_host', row);
}

module.exports = { upsertHost };
