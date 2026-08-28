const { Status } = require('discord.js');
const botStatusDb = require('../db/botStatus');
const botHostDb = require('../db/botHost');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const HEARTBEAT_INTERVAL_MS = 10_000;

function statusLabel(status) {
  return Status[status] ?? 'Unknown';
}

async function reportStatus(client) {
  const guildsPerShard = new Map();
  for (const guild of client.guilds.cache.values()) {
    const id = guild.shardId ?? 0;
    guildsPerShard.set(id, (guildsPerShard.get(id) ?? 0) + 1);
  }

  for (const [shardId, shard] of client.ws.shards) {
    await botStatusDb
      .upsertShardStatus(shardId, statusLabel(shard.status), guildsPerShard.get(shardId) ?? 0, shard.ping >= 0 ? Math.round(shard.ping) : null)
      .catch((err) => logger.error(`Failed to report status for shard ${shardId}:`, err));
  }

  const memoryMb = Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
  await botHostDb.upsertHost(Math.floor(process.uptime()), memoryMb, process.version).catch((err) => logger.error('Failed to report host stats:', err));
}

function startStatusHeartbeatJob(client) {
  const run = exclusiveTask(() => reportStatus(client));
  run().catch((err) => logger.error('Status heartbeat job error:', err));
  setInterval(() => run().catch((err) => logger.error('Status heartbeat job error:', err)), HEARTBEAT_INTERVAL_MS).unref?.();
  logger.info('Status heartbeat job started (reporting every 10s).');
}

module.exports = { startStatusHeartbeatJob };
