// i18n-ignore-file: a job, it only logs for the team.
// Gives the aged roles (utils/agedRoles.ts `runAgedRoles`): every 30 minutes, the members who have been in the server long enough get the role, and the role that goes away is taken.
// Written in TypeScript: compiled over agedRolesJob.js.
import type { Client } from 'discord.js';
import { runAgedRoles } from '../utils/agedRoles';

const logger = require('../utils/logger') as { info: (message: string) => void; error: (message: string, error?: unknown) => void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask: <T>(task: () => Promise<T>) => () => Promise<T | undefined> };
const loadGuard = require('../utils/loadGuard') as { level: () => string };

const POLL_INTERVAL_MS = 30 * 60_000;
const FIRST_RUN_MS = 3 * 60_000;

export function startAgedRolesJob(client: Client): void {
  const run = exclusiveTask(async () => {
    if (loadGuard.level() !== 'normal') return; // the bot is struggling: it waits for the next look
    await runAgedRoles(client);
  });
  const safe = (): void => { run().catch((error: unknown) => logger.error('Aged roles job error:', error)); };
  setTimeout(safe, FIRST_RUN_MS).unref?.();
  setInterval(safe, POLL_INTERVAL_MS).unref?.();
  logger.info('Aged roles job started (looking every 30 minutes).');
}
