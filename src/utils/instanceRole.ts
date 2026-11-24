// i18n-ignore-file: internal plumbing between instances of the bot (operator logs only).
// The role of an instance. `primary` (the default) is the one that has the database and runs everything. `worker` is a second instance (a VPS, a Docker container) that holds its own
// shards (DISCORD_SHARDS and DISCORD_SHARD_COUNT) and shares the database through the bridge (src/db/sqlBridge.ts). A worker does not serve the web API, does not register the slash commands,
// does not change the schema and, of the background jobs, runs what `PETTO_WORKER_JOBS` says:
//   guild (default)      everything except the jobs that must run once for the whole bot (`ONE_PER_BOT`), for the servers of its own shards: a job of a split instance only sees the rows of its own
//                        servers (src/db/postgres.js: the query builder adds the condition, a raw SELECT drops the other rows, and the claim of the code schedule names the shards), so the two
//                        instances never do the same work twice or give up on a server they do not hold;
//   essential            only the jobs that hold the memory of this instance (buffered activity, voice XP, command data, staying in voice), the rest is left to the primary;
//   all                  everything, as the primary does.
// Plain functions, checked on their own (scripts/check-instance-role.js).

/** The jobs that keep memory of the instance itself (what it buffers, the voice channels it is in): a worker runs them, or what its members do would be lost. */
export const ESSENTIAL_JOBS: ReadonlySet<string> = new Set(['startActivityStatsJob', 'startVoiceXpJob', 'startCommandDataJob', 'startStayVoiceJob']);

/** The jobs that must run once for the whole bot (its status, global numbers, the purge of departed servers, Premium, alerts and cleanups of the database): never on a worker, in any mode but `all`. */
export const ONE_PER_BOT: ReadonlySet<string> = new Set([
  'startStatusHeartbeatJob', 'startStatusProbeJob', 'startGlobalStatsJob', 'startGuildPurgeJob', 'startQuestAlertsJob', 'startRolloutAlertsJob',
  'startPremiumRoleJob', 'startPremiumCleanupJob', 'startPremiumLogJob', 'startPremiumWatchJob', 'startFormCleanupJob', 'startAppealCleanupJob', 'startVerifyChecksJob',
]);

/** The names the perf measurement gives to those jobs (`startGuildPurgeJob` -> `guildPurgeJob`, with a possible `@60s` suffix for a second interval of the same job). */
const GLOBAL_JOB_NAMES: ReadonlySet<string> = new Set([...ONE_PER_BOT].map((name) => name.replace(/^start/, '').replace(/^./, (letter) => letter.toLowerCase())));

/** Whether a measured job name (`guildPurgeJob`, `guildPurgeJob@60s`) is one of the jobs that work on the whole bot, never on the servers of a shard. */
export function isGlobalJob(name: unknown): boolean {
  return GLOBAL_JOB_NAMES.has(String(name ?? '').split('@')[0]);
}

export type Role = 'primary' | 'worker';
export type WorkerJobs = 'essential' | 'guild' | 'all';

type Env = Record<string, string | undefined>;

export function roleOf(env: Env = process.env): Role {
  return String(env.PETTO_ROLE ?? 'primary').trim().toLowerCase() === 'worker' ? 'worker' : 'primary';
}

export function workerJobsOf(env: Env = process.env): WorkerJobs {
  const value = String(env.PETTO_WORKER_JOBS ?? 'guild').trim().toLowerCase();
  return value === 'essential' || value === 'all' ? value : 'guild';
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
