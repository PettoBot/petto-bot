const { Status } = require('discord.js');
const botStatusDb = require('../db/botStatus');
const botHostDb = require('../db/botHost');
const logger = require('../utils/logger');
const { isTransientDbError } = require('../utils/transientDb');

const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_TRANSIENT_BACKOFF_MS = 60_000;
const TRANSIENT_ERROR_LOG_INTERVAL_MS = 60_000;

let transientFailureStreak = 0;
let lastTransientErrorLogAt = 0;
let suppressedTransientErrors = 0;
let started = false;

function statusLabel(status) {
  return Status[status] ?? 'Unknown';
}

async function reportStatus(client) {
  const guildsPerShard = new Map();
  const failures = [];
  for (const guild of client.guilds.cache.values()) {
    const id = guild.shardId ?? 0;
    guildsPerShard.set(id, (guildsPerShard.get(id) ?? 0) + 1);
  }

  for (const [shardId, shard] of client.ws.shards) {
    try {
      await botStatusDb.upsertShardStatus(
        shardId,
        statusLabel(shard.status),
        guildsPerShard.get(shardId) ?? 0,
        shard.ping >= 0 ? Math.round(shard.ping) : null,
      );
    } catch (error) {
      failures.push({ label: `shard ${shardId}`, error });
    }
  }

  const memoryMb = Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
  try {
    await botHostDb.upsertHost(Math.floor(process.uptime()), memoryMb, process.version);
  } catch (error) {
    failures.push({ label: 'host stats', error });
  }

  return failures;
}

function transientBackoffMs() {
  return Math.min(HEARTBEAT_INTERVAL_MS * (2 ** Math.min(transientFailureStreak, 3)), MAX_TRANSIENT_BACKOFF_MS);
}

function logFailures(failures) {
  if (!failures.length) return;
  const first = failures[0];
  const labels = failures.map((failure) => failure.label).join(', ');
  const allTransient = failures.every((failure) => isTransientDbError(failure.error));

  if (!allTransient) {
    logger.error(`Status heartbeat failed (${labels}):`, first.error);
    return;
  }

  const now = Date.now();
  if (now - lastTransientErrorLogAt < TRANSIENT_ERROR_LOG_INTERVAL_MS) {
    suppressedTransientErrors += 1;
    return;
  }

  const suffix = suppressedTransientErrors ? `; ${suppressedTransientErrors} similar errors suppressed` : '';
  suppressedTransientErrors = 0;
  lastTransientErrorLogAt = now;
  logger.error(`Status heartbeat temporarily unavailable (${labels}${suffix}):`, first.error);
}

function startStatusHeartbeatJob(client) {
  if (started) {
    logger.warn('Status heartbeat job start ignored because it is already running.');
    return;
  }
  started = true;

  const tick = async () => {
    let nextDelay = HEARTBEAT_INTERVAL_MS;
    try {
      const failures = await reportStatus(client);
      if (!failures.length) {
        transientFailureStreak = 0;
      } else {
        const allTransient = failures.every((failure) => isTransientDbError(failure.error));
        if (allTransient) {
          transientFailureStreak += 1;
          nextDelay = transientBackoffMs();
        }
        logFailures(failures);
      }
    } catch (error) {
      if (isTransientDbError(error)) {
        transientFailureStreak += 1;
        nextDelay = transientBackoffMs();
      }
      logFailures([{ label: 'heartbeat', error }]);
    } finally {
      setTimeout(tick, nextDelay).unref?.();
    }
  };

  tick().catch((error) => logger.error('Status heartbeat job startup error:', error));
  logger.info('Status heartbeat job started (reporting every 10s, with transient DB backoff).');
}

module.exports = { startStatusHeartbeatJob };
