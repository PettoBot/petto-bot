// i18n-ignore-file: a job, it only logs for the team.
// Keeps the category "@ stats" of the support server (utils/statsCategory.ts): it is made when the bot starts and the numbers are updated every 10 minutes.
// Without PETTO_SUPPORT_GUILD_ID it does nothing. Written in TypeScript: compiled over statsCategoryJob.js.
import type { Client } from 'discord.js';
import { STATS_EVERY_MS, updateStatsCategory } from '../utils/statsCategory';
import { readTotals } from '../utils/botTotals';

const logger = require('../utils/logger') as { info: (message: string) => void; warn: (message: string) => void; error: (message: string, error?: unknown) => void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask: <T>(task: () => Promise<T>) => () => Promise<T | undefined> };
const config = require('../config') as { supportGuildId: string | null };

const FIRST_RUN_MS = 45_000; // after the servers are in the cache, so the numbers are whole from the first time

export function startStatsCategoryJob(client: Client): void {
  const run = exclusiveTask(async () => {
    // The numbers of the whole bot, not only of the shards this process holds (see utils/botTotals.ts).
    const totals = await readTotals(client);
    const report = await updateStatsCategory(client, config.supportGuildId, { servers: totals.servers, members: totals.members });
    if (report.skipped) logger.warn(`Stats category not updated: ${report.skipped}.`);
    else if (report.created.length || report.renamed.length) logger.info(`Stats category: created ${report.created.join(', ') || 'nothing'}; renamed ${report.renamed.join(', ') || 'nothing'}.`);
  });
  const runLogged = (): void => { run().catch((error: unknown) => logger.error('Stats category failed:', error)); };
  setTimeout(runLogged, FIRST_RUN_MS).unref?.();
  setInterval(runLogged, STATS_EVERY_MS).unref?.();
  logger.info('Stats category job started (every 10 minutes).');
}
