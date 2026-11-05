// Role triggers see a role being given only for a member that is in Petto's cache (discord.js emits no `guildMemberUpdate` for an uncached member: it
// caches it and emits `guildMemberAvailable`, with no old copy). Members who join while Petto is online are cached by `guildMemberAdd`; the gap is the
// members already in the server that Petto has not seen since it started. This file loads the members of the servers that have rules, with a size cap,
// one server at a time and never under load. The decision is a plain function (checked without Discord); the rest runs it.
// i18n-ignore-file: log lines for the operator.
const logger = require('./logger');
const loadGuard = require('./loadGuard');
const { withTimeout } = require('./withTimeout');

const MAX_GUILD_MEMBERS = 25_000; // above this one server is not loaded: it could eat the RAM of a 1 GB host
const MAX_TOTAL_MEMBERS = 100_000; // all the servers together, for the life of the process
const COMPLETE_RATIO = 0.95; // a cache with at least this share of the members is "complete": the rest are inactive or joined meanwhile
const STAGGER_MS = 20_000; // between two servers (the request-members opcode of the gateway is rate limited)
const FETCH_TIMEOUT_MS = 120_000;
const RETRY_LOAD_MS = 5 * 60_000; // a server skipped because of the load is tried again after this
const RETRY_LOAD_MAX = 6;
const COOLDOWN_MS = 10 * 60_000; // the same server is not loaded twice in this time

/**
 * What to do for one server. `warm` loads it; the others say why not: `complete` (nothing to do), `unknown` (no member count), `too_large` (above the cap or
 * the budget: the admin is told), `load` (the bot is degraded or critical: the admin is told, and it is tried again).
 */
function warmDecision({ memberCount, cacheSize, loadLevel = 'normal', maxMembers = MAX_GUILD_MEMBERS, budgetLeft = MAX_TOTAL_MEMBERS }) {
  if (!Number.isFinite(memberCount) || memberCount <= 0) return 'unknown';
  if (cacheSize >= memberCount * COMPLETE_RATIO) return 'complete';
  if (memberCount > maxMembers || memberCount > budgetLeft) return 'too_large';
  if (loadLevel !== 'normal') return 'load';
  return 'warm';
}

/** True when role grants of unseen members may be missed in this server (what `list` and `add` tell the admin). Needs no load level: it is about the cache. */
function mayMissMembers({ memberCount, cacheSize, maxMembers = MAX_GUILD_MEMBERS, budgetLeft = MAX_TOTAL_MEMBERS, loaded = false }) {
  const decision = warmDecision({ memberCount, cacheSize, loadLevel: 'normal', maxMembers, budgetLeft });
  if (decision === 'complete' || decision === 'unknown') return false;
  return decision === 'too_large' || !loaded;
}

/** Runs the jobs one at a time, `gapMs` apart (a job that returns `'retry'` is queued again after `retryMs`, up to `retryMax` times). */
function createWarmQueue({ gapMs = STAGGER_MS, retryMs = RETRY_LOAD_MS, retryMax = RETRY_LOAD_MAX, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timer = setTimeout } = {}) {
  const pending = [];
  const queued = new Set();
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      let first = true;
      while (pending.length) {
        const job = pending.shift();
        if (!first) await sleep(gapMs);
        first = false;
        let result;
        try { result = await job.run(); } catch (err) { logger.localWarn(`Role triggers: could not load the members of guild ${job.key}: ${err?.message ?? err}`); }
        queued.delete(job.key);
        if (result === 'retry' && job.tries < retryMax) {
          const t = timer(() => push(job.key, job.run, job.tries + 1), retryMs);
          t?.unref?.();
        }
      }
    } finally { running = false; }
  }
  function push(key, run, tries = 0) {
    if (queued.has(key)) return false;
    queued.add(key);
    pending.push({ key, run, tries });
    drain();
    return true;
  }
  return { push, size: () => pending.length, isRunning: () => running };
}

const state = { warmed: new Set(), at: new Map(), budgetUsed: 0, queue: createWarmQueue() };

const budgetLeft = () => MAX_TOTAL_MEMBERS - state.budgetUsed;

/** Loads the members of one server when `warmDecision` says so. Returns the decision (`'retry'` is the one for the load, so the queue tries again). */
async function warmGuild(guild, { force = false } = {}) {
  const decision = warmDecision({ memberCount: guild.memberCount, cacheSize: guild.members.cache.size, loadLevel: loadGuard.level(), budgetLeft: budgetLeft() });
  if (decision === 'complete') state.warmed.add(guild.id);
  if (decision !== 'warm') return decision === 'load' ? 'retry' : decision;
  if (!force && Date.now() - (state.at.get(guild.id) ?? 0) < COOLDOWN_MS) return 'cooldown';
  state.at.set(guild.id, Date.now());
  const before = guild.members.cache.size;
  try {
    await withTimeout(guild.members.fetch({ time: FETCH_TIMEOUT_MS }), FETCH_TIMEOUT_MS + 5_000, 'member fetch');
    state.warmed.add(guild.id);
    state.budgetUsed += Math.max(0, guild.members.cache.size - before);
    logger.info(`Role triggers: loaded the members of guild ${guild.id} (${before} -> ${guild.members.cache.size} of ${guild.memberCount}).`);
    return 'warm';
  } catch (err) {
    logger.localWarn(`Role triggers: could not load the members of guild ${guild.id}, role grants of unseen members may be missed: ${err?.message ?? err}`);
    return 'failed';
  }
}

/** Queues one server (the queue spaces the servers and keeps a server from being queued twice). */
function scheduleGuild(guild, opts) {
  return state.queue.push(guild.id, () => warmGuild(guild, opts));
}

/** After the guilds are ready: every server that has a rule, one at a time. */
async function warmAll(client, guildIdsWithRules) {
  let count = 0;
  for (const id of guildIdsWithRules) {
    const guild = client.guilds.cache.get(String(id));
    if (guild && scheduleGuild(guild)) count += 1;
  }
  if (count) logger.info(`Role triggers: loading the members of ${count} server(s) that have rules, one every ${STAGGER_MS / 1000} s.`);
  return count;
}

/** For `list` and `add`: should the admin be told that some members may be missed. `loading` is true right after the server was queued (it will be loaded unless the load is high). */
function coverageWarning(guild, { loading = false } = {}) {
  const loaded = state.warmed.has(guild.id) || (loading && loadGuard.level() === 'normal');
  return mayMissMembers({ memberCount: guild.memberCount, cacheSize: guild.members.cache.size, budgetLeft: budgetLeft(), loaded });
}

module.exports = {
  MAX_GUILD_MEMBERS, MAX_TOTAL_MEMBERS, COMPLETE_RATIO, STAGGER_MS, RETRY_LOAD_MS, RETRY_LOAD_MAX, COOLDOWN_MS,
  warmDecision, mayMissMembers, createWarmQueue, warmGuild, scheduleGuild, warmAll, coverageWarning,
  _state: state,
};
