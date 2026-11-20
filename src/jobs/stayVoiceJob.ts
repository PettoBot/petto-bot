// i18n-ignore-file: a job, it only logs for the team.
// Stay in voice (utils/stayVoice.ts): 30 seconds after the bot starts and then every minute, every server that asked for it gets Petto back in its voice channel when it is out of
// it, and the status of the channel written again (every 30 minutes, or when the text changed). It waits when the bot is busy. Written in TypeScript: compiled over stayVoiceJob.js.
import type { Client } from 'discord.js';
import { tick } from '../utils/stayVoice';

const logger = require('../utils/logger') as { info: (message: string) => void; error: (message: string, error?: unknown) => void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask: <T>(task: () => Promise<T>) => () => Promise<T | undefined> };
const loadGuard = require('../utils/loadGuard') as { level: () => string };

const EVERY_MS = 60_000;
const FIRST_MS = 30_000;

export function startStayVoiceJob(client: Client): void {
  const round = exclusiveTask(async () => {
    if (loadGuard.level() === 'critical') return;
    await tick(client);
  });
  const run = (): void => { round().catch((error) => logger.error('Stay in voice job error:', error)); };
  setTimeout(run, FIRST_MS).unref?.();
  setInterval(run, EVERY_MS).unref?.();
  logger.info('Stay in voice job started (looking at the servers that asked for it every minute).');
}
