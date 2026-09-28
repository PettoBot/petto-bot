const database = require('./database');
const { retryIdempotent } = require('../utils/transientDb');

async function upsertHost(uptimeSeconds, memoryMb, nodeVersion) {
  const row = {
      id: 1,
      uptime_seconds: uptimeSeconds,
      memory_mb: memoryMb,
      node_version: nodeVersion,
      updated_at: new Date().toISOString(),
  };

  await retryIdempotent(async () => {
    const { error } = await database.from('bot_host').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  });
}

module.exports = { upsertHost };
