// i18n-ignore-file: a job, it only logs for the team.
// Writes the activity leaderboards that are due (utils/activityLeaderboard.ts `runDueBoards`): every board is looked at about every 5 minutes (and a card is only edited when it
// says something new), and one that was just set (or whose channel was changed from the dashboard) is written at the next look, which is every minute. At the same look it gives
// the role of the most active member of the week that just ended to the servers that chose one (utils/activityTopRole.ts `runDueRoles`). Written in TypeScript: compiled over
// activityLeaderboardJob.js.
import type { Client } from 'discord.js';
import { runDueBoards } from '../utils/activityLeaderboard';
import { runDueRoles } from '../utils/activityTopRole';

const logger = require('../utils/logger') as { info: (message: string) => void; error: (message: string, error?: unknown) => void };
const { exclusiveTask } = require('../utils/concurrency') as { exclusiveTask: <T>(task: () => Promise<T>) => () => Promise<T | undefined> };
const loadGuard = require('../utils/loadGuard') as { level: () => string };

// Every minute: a board is due 270 seconds after its last time (db/activityLeaderboards.ts `REFRESH_SECONDS`), so this is what makes it about every 5 minutes.
const POLL_INTERVAL_MS = 60_000;
const FIRST_RUN_MS = 2 * 60_000;

export function startActivityLeaderboardJob(client: Client): void {
  const run = exclusiveTask(async () => {
    // Boards are not essential: when the bot is struggling they wait (the load guard also pauses this job when the bot is degraded, see `SHED_IN_DEGRADED_JOBS`).
    if (loadGuard.level() === 'critical') return;
    await runDueBoards(client);
    await runDueRoles(client); // the role of the most active member of the week that just ended, for the servers that asked for it
  });
  const safe = (): void => { run().catch((error: unknown) => logger.error('Activity leaderboard job error:', error)); };
  setTimeout(safe, FIRST_RUN_MS).unref?.();
  setInterval(safe, POLL_INTERVAL_MS).unref?.();
  logger.info('Activity leaderboard job started (looking every minute for boards and roles that are due).');
}
