// i18n-ignore-file: a job, it only logs for the team.
// Stay in voice (utils/stayVoice.ts): 15 seconds after the bot starts and then every 20 seconds, every server that asked for it gets Petto back in its voice channel when it is out of
// it, and the status of the channel written again (every 30 minutes, or when the text changed). It is an essential job of the load guard (it is one small query when everything is in place), so a busy bot does not leave Petto out of the channel. Written in TypeScript: compiled over stayVoiceJob.js.
import type { Client } from 'discord.js';
import { tick } from '../utils/stayVoice';

const logger = require('../utils/logger') as { info: (message: string) => void; error: (message: string, error?: unknown) => void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask: <T>(task: () => Promise<T>) => () => Promise<T | undefined> };

const EVERY_MS = 5_000;
const FIRST_MS = 10_000;

export function startStayVoiceJob(client: Client): void {
  const round = exclusiveTask(async () => {
    await tick(client);
  });
  const run = (): void => { round().catch((error) => logger.error('Stay in voice job error:', error)); };
  setTimeout(run, FIRST_MS).unref?.();
  setInterval(run, EVERY_MS).unref?.();
  logger.info('Stay in voice job started (looking at the servers that asked for it every 20 seconds).');
}
