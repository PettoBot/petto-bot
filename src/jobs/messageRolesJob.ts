// i18n-ignore-file: a job, it only logs for the team.
// Message roles (utils/messageRoles.ts): every 20 seconds what was counted is written and the members who wrote get their roles; every 30 minutes the roles of the `period` rules that take
// them away are looked at; every day the days older than a year are deleted. Written in TypeScript: compiled over messageRolesJob.js.
import type { Client } from 'discord.js';
import { flush, prune, runRemovals } from '../utils/messageRoles';

const logger = require('../utils/logger') as { info: (message: string) => void; error: (message: string, error?: unknown) => void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask: <T>(task: () => Promise<T>) => () => Promise<T | undefined> };
const loadGuard = require('../utils/loadGuard') as { level: () => string };

const FLUSH_MS = 20_000;
const REMOVALS_MS = 30 * 60_000;
const PRUNE_MS = 24 * 3_600_000;

export function startMessageRolesJob(client: Client): void {
  const flushing = exclusiveTask(async () => { await flush(client); }); // counting is never skipped when the bot is busy: it only writes in batches
  const removing = exclusiveTask(async () => {
    if (loadGuard.level() !== 'normal') return;
    await runRemovals(client);
  });
  const log = (name: string) => (error: unknown): void => { logger.error(`Message roles ${name} error:`, error); };
  setInterval(() => { flushing().catch(log('flush')); }, FLUSH_MS).unref?.();
  setTimeout(() => { removing().catch(log('removals')); }, 5 * 60_000).unref?.();
  setInterval(() => { removing().catch(log('removals')); }, REMOVALS_MS).unref?.();
  setTimeout(() => { prune().catch(log('prune')); }, 10 * 60_000).unref?.();
  setInterval(() => { prune().catch(log('prune')); }, PRUNE_MS).unref?.();
  logger.info('Message roles job started (writing counts every 20 seconds, looking at removals every 30 minutes).');
}
