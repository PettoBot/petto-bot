// i18n-ignore-file: only lines of the log of the host.
// Runs the commands that Petto Code scheduled with scheduleUniqueCC (db/commandData `schedule`): every few seconds the ones that are due are taken and run.
// They are kept in the database, so a restart does not lose them; one that was due while the bot was off runs when it is back.
const commandData = require('../db/commandData') as { schedule: { claimDue(limit: number): Promise<Array<{ guildId: string; name: string; id: string; userId: string; channelId: string; data: unknown; origin?: string }>> } };
const logger = require('../utils/logger') as { info(text: string): void; warn(text: string): void; error(text: string, error?: unknown): void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask(task: () => Promise<void>): () => Promise<void> };

const POLL_MS = 10_000;

export function startCodeScheduleJob(client: unknown, options: { pollMs?: number } = {}): { stop(): void } {
  const run = exclusiveTask(async () => {
    const { runScheduled } = require('../utils/codeCommands') as { runScheduled(client: unknown, entry: unknown): Promise<boolean> };
    const due = await commandData.schedule.claimDue(20);
    for (const entry of due) {
      await runScheduled(client, entry).catch((error: Error) => logger.error(`A scheduled command (${entry.name}) crashed in guild ${entry.guildId}:`, error));
    }
  });
  const tick = (): void => { run().catch((error: Error) => logger.error('The job of the scheduled commands failed:', error)); };
  const first = setTimeout(tick, 15_000);
  const timer = setInterval(tick, options.pollMs ?? POLL_MS);
  first.unref?.();
  timer.unref?.();
  logger.info('Scheduled commands job started (looking every 10 seconds for commands that are due).');
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}
