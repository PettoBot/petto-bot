// i18n-ignore-file: status heartbeat for the Petto team (logs).
// Every 10 seconds each instance of the bot says how its own shards are doing (state, ping, servers and members, and the name and place of the instance), so the status page shows every shard.
// Only the primary also says how its process is doing (uptime, memory): that is a single row.
// Written in TypeScript: `npm run build:ts` compiles it over statusHeartbeatJob.js.
import { isWorker } from '../utils/instanceRole';
import { clusterOf, collectShards, type ShardClient } from '../utils/shardReport';

const botStatusDb = require('../db/botStatus') as { upsertShardStatus: (shardId: number, status: string, guildCount: number, pingMs: number | null, extra?: { memberCount?: number; clusterName?: string | null; clusterLocation?: string | null }) => Promise<void> };
const botHostDb = require('../db/botHost') as { upsertHost: (uptimeSeconds: number, memoryMb: number, nodeVersion: string) => Promise<void> };
const logger = require('../utils/logger') as { info: (message: string) => void; warn: (message: string) => void; error: (message: string, error?: unknown) => void };
const { isTransientDbError } = require('../utils/transientDb') as { isTransientDbError: (error: unknown) => boolean };

const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_TRANSIENT_BACKOFF_MS = 60_000;
const TRANSIENT_ERROR_LOG_INTERVAL_MS = 60_000;

interface Failure { label: string; error: unknown }

let transientFailureStreak = 0;
let lastTransientErrorLogAt = 0;
let suppressedTransientErrors = 0;
let started = false;

async function reportStatus(client: ShardClient): Promise<Failure[]> {
  const failures: Failure[] = [];
  const cluster = clusterOf();

  for (const row of collectShards(client)) {
    try {
      await botStatusDb.upsertShardStatus(row.shardId, row.status, row.guildCount, row.pingMs, { memberCount: row.memberCount, clusterName: cluster.name, clusterLocation: cluster.location });
    } catch (error) {
      failures.push({ label: `shard ${row.shardId}`, error });
    }
  }

  // The row of the process is one for the whole bot: only the primary writes it, or the instances would overwrite each other's numbers.
  if (!isWorker()) {
    const memoryMb = Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
    try {
      await botHostDb.upsertHost(Math.floor(process.uptime()), memoryMb, process.version);
    } catch (error) {
      failures.push({ label: 'host stats', error });
    }
  }

  return failures;
}

function transientBackoffMs(): number {
  return Math.min(HEARTBEAT_INTERVAL_MS * (2 ** Math.min(transientFailureStreak, 3)), MAX_TRANSIENT_BACKOFF_MS);
}

function logFailures(failures: Failure[]): void {
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

export function startStatusHeartbeatJob(client: ShardClient): void {
  if (started) {
    logger.warn('Status heartbeat job start ignored because it is already running.');
    return;
  }
  started = true;

  const tick = async (): Promise<void> => {
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
      setTimeout(() => { tick().catch(() => undefined); }, nextDelay).unref?.();
    }
  };

  tick().catch((error: unknown) => logger.error('Status heartbeat job startup error:', error));
  logger.info(`Status heartbeat job started (reporting the shards of this instance every 10s, with transient DB backoff${isWorker() ? '' : '; the primary also reports the host'}).`);
}
