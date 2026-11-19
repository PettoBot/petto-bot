// i18n-ignore-file: a job, it only logs for the team.
// Looks every 15 seconds at the Premium that changed (utils/premiumWatch.ts): the person gets or loses the Premium role at once and the change is recorded in the Premium channel of the team.
// It is one small query when nothing changed. Written in TypeScript: compiled over premiumWatchJob.js.
import type { Client } from 'discord.js';
import { WATCH_MS, newState, watchOnce } from '../utils/premiumWatch';

const logger = require('../utils/logger') as { info: (message: string) => void; error: (message: string, error?: unknown) => void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask: <T>(task: () => Promise<T>) => () => Promise<T | undefined> };

const FIRST_RUN_MS = 20_000;

export function startPremiumWatchJob(client: Client): void {
  const state = newState();
  const run = exclusiveTask(async () => { await watchOnce(state, { client }); });
  const runLogged = (): void => { run().catch((error: unknown) => logger.error('Premium watch failed:', error)); };
  // The first look only remembers how everything is (what was before the start is not a change); it is after the cache and the database are ready.
  setTimeout(runLogged, FIRST_RUN_MS).unref?.();
  setInterval(runLogged, WATCH_MS).unref?.();
  logger.info('Premium watch started (looking at Premium changes every 15 seconds).');
}
