// i18n-ignore-file: internal plumbing between instances of the bot (operator logs only).
// The role of an instance. `primary` (the default) is the one that has the database and runs everything. `worker` is a second instance (a VPS, a Docker container) that holds its own
// shards (DISCORD_SHARDS and DISCORD_SHARD_COUNT) and shares the database through the bridge (src/db/sqlBridge.ts). A worker does not serve the web API, does not register the slash commands,
// does not change the schema and, of the background jobs, runs only what `PETTO_WORKER_JOBS` says:
//   essential (default)  only the jobs that hold the memory of this instance (buffered activity, voice XP, command data, staying in voice): without them what its own members do is lost;
//   guild                everything except the jobs that must run once for the whole bot (`ONE_PER_BOT`): for the servers of its shards too, but those jobs were not checked one by one
//                        for servers the instance does not hold, so it is for testing;
//   all                  everything, as the primary does.
// Plain functions, checked on their own (scripts/check-instance-role.js).

/** The jobs that keep memory of the instance itself (what it buffers, the voice channels it is in): a worker runs them, or what its members do would be lost. */
export const ESSENTIAL_JOBS: ReadonlySet<string> = new Set(['startActivityStatsJob', 'startVoiceXpJob', 'startCommandDataJob', 'startStayVoiceJob']);

/** The jobs that must run once for the whole bot (its status, global numbers, the purge of departed servers, Premium, alerts and cleanups of the database): never on a worker, in any mode but `all`. */
export const ONE_PER_BOT: ReadonlySet<string> = new Set([
  'startStatusHeartbeatJob', 'startStatusProbeJob', 'startGlobalStatsJob', 'startGuildPurgeJob', 'startQuestAlertsJob', 'startRolloutAlertsJob',
  'startPremiumRoleJob', 'startPremiumCleanupJob', 'startPremiumLogJob', 'startPremiumWatchJob', 'startFormCleanupJob', 'startAppealCleanupJob', 'startVerifyChecksJob',
]);

export type Role = 'primary' | 'worker';
export type WorkerJobs = 'essential' | 'guild' | 'all';

type Env = Record<string, string | undefined>;

export function roleOf(env: Env = process.env): Role {
  return String(env.PETTO_ROLE ?? 'primary').trim().toLowerCase() === 'worker' ? 'worker' : 'primary';
}

export function workerJobsOf(env: Env = process.env): WorkerJobs {
  const value = String(env.PETTO_WORKER_JOBS ?? 'essential').trim().toLowerCase();
  return value === 'guild' || value === 'all' ? value : 'essential';
}

export const isWorker = (env: Env = process.env): boolean => roleOf(env) === 'worker';

/** Whether this instance starts a background job (`name` is the start function: `startStreakJob`). */
export function shouldRun(name: string, env: Env = process.env): boolean {
  if (roleOf(env) === 'primary') return true;
  const mode = workerJobsOf(env);
  if (mode === 'all') return true;
  if (mode === 'guild') return !ONE_PER_BOT.has(name);
  return ESSENTIAL_JOBS.has(name);
}

/** What a worker leaves to the primary, for the start of the bot to say once. */
export function describe(env: Env = process.env): string {
  if (roleOf(env) === 'primary') return 'primary';
  return `worker (jobs: ${workerJobsOf(env)}; no web API, no slash command registration, no schema)`;
}
