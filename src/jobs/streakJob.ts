// i18n-ignore-file: a job, it only logs for the team.
// Gives what the streaks earn (utils/streakRewards.ts `runStreakRewards`): every 10 minutes, the announcements of the milestones and the reward roles of the servers that set them.
// Written in TypeScript: compiled over streakJob.js.
import type { Client } from 'discord.js';
import { runStreakRewards } from '../utils/streakRewards';

const logger = require('../utils/logger') as { info: (message: string) => void; error: (message: string, error?: unknown) => void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask: <T>(task: () => Promise<T>) => () => Promise<T | undefined> };
const loadGuard = require('../utils/loadGuard') as { level: () => string };

const POLL_INTERVAL_MS = 10 * 60_000;
const FIRST_RUN_MS = 4 * 60_000;

export function startStreakJob(client: Client): void {
  const run = exclusiveTask(async () => {
    if (loadGuard.level() !== 'normal') return; // the bot is struggling: it waits for the next look
    await runStreakRewards(client);
  });
  const safe = (): void => { run().catch((error: unknown) => logger.error('Streak job error:', error)); };
  setTimeout(safe, FIRST_RUN_MS).unref?.();
  setInterval(safe, POLL_INTERVAL_MS).unref?.();
  logger.info('Streak job started (looking every 10 minutes).');
}
