// i18n-ignore-file: a job, it only logs for the team.
// Writes the activity leaderboards that are due (utils/activityLeaderboard.ts `runDueBoards`): every board is edited about once an hour, and one that was just set (or whose
// channel was changed from the dashboard) is written at the next look, which is every 5 minutes. Written in TypeScript: compiled over activityLeaderboardJob.js.
import type { Client } from 'discord.js';
import { runDueBoards } from '../utils/activityLeaderboard';

const logger = require('../utils/logger') as { info: (message: string) => void; error: (message: string, error?: unknown) => void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask: <T>(task: () => Promise<T>) => () => Promise<T | undefined> };
const loadGuard = require('../utils/loadGuard') as { level: () => string };

const POLL_INTERVAL_MS = 5 * 60_000;
const FIRST_RUN_MS = 2 * 60_000;

export function startActivityLeaderboardJob(client: Client): void {
  const run = exclusiveTask(async () => {
    // Boards are not essential: when the bot is struggling they wait (they are only an hour late).
    if (loadGuard.level() === 'critical') return;
    await runDueBoards(client);
  });
  const safe = (): void => { run().catch((error: unknown) => logger.error('Activity leaderboard job error:', error)); };
  setTimeout(safe, FIRST_RUN_MS).unref?.();
  setInterval(safe, POLL_INTERVAL_MS).unref?.();
  logger.info('Activity leaderboard job started (looking every 5 minutes for boards that are due).');
}
