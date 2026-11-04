// i18n-ignore-file: internal load protection (logs and the private `!perf` tool).
// The circuit breaker and the load shedding. Every 5 seconds the guard looks at what is measured (the lag of the event loop, how long a request waits
// in our queue to Discord, how many wait, memory) and keeps the bot at one of three levels:
//   normal    everything runs;
//   degraded  the work that can wait is paused (feeds, snapshots, counters, the safety-net jobs, low-value logs), the buckets of the prefix commands
//             are halved, the sticky messages wait longer and the cards fall back to plain messages;
//   critical  only the essential work is done: interactions, the commands of staff, moderation, tickets and verification. Everything else is dropped.
// The level goes up at once and goes down slowly (`calmSeconds` of calm for each step), and it changes the alert of the team once for each change.
// Nothing here runs in normal mode: the guard only reads numbers, and `allows...` answers true.
const logger = require('./logger');

const LEVELS = ['normal', 'degraded', 'critical'];
const RANK = { normal: 0, degraded: 1, critical: 2 };
const TICK_MS = 5_000;

// Jobs that must keep running at any level (a punishment that expires, a lockdown, a join that is waiting, the checks of this file).
const ESSENTIAL_JOBS = new Set(['expireSanctions', 'lockdownJob', 'antiScamJob', 'joinGateJob', 'verifyPanelJob', 'loadGuard', 'watchdog', 'redis', 'statusHeartbeatJob', 'guildBlacklist', 'index', 'perf']);
// Jobs that are paused as soon as the bot is degraded (and also in critical): they catch up by themselves when they run again.
const SHED_IN_DEGRADED_JOBS = new Set([
  'feedsJob', 'guildSnapshotJob', 'counterJob', 'bumpReminderJob', 'globalStatsJob', 'omniplexStatsJob', 'commandDataJob', 'afkMentionsJob', 'birthdayJob',
  'forumJob', 'maliciousFeedJob', 'questAlertsJob', 'rolloutAlertsJob', 'requestTimeoutJob', 'formCleanupJob', 'backupVaultJob', 'appealCleanupJob',
  'premiumCleanupJob', 'premiumLogJob', 'premiumRoleJob', 'ticketAutoDeleteJob', 'ticketChannelJob', 'ticketReminderJob', 'ticketAutocloseJob',
  'pollAutocloseJob', 'countingRoleJob', 'guildPurgeJob', 'dataMoveJob', 'discordOps', 'guildSnapshots',
]);
// Listeners of events that only write a log of low value: skipped when degraded.
const SHED_IN_DEGRADED_EVENTS = new Set([
  'messageUpdatePublishLog', 'applicationCommandPermissionsUpdateLog', 'channelPinsUpdateLog', 'pollVoteAddLog', 'pollVoteRemoveLog', 'scheduledEventUserAddLog',
  'scheduledEventUserRemoveLog', 'webhooksUpdateLog', 'guildIntegrationsUpdateLog', 'soundboardCreate', 'soundboardDelete', 'soundboardUpdate', 'stageInstanceCreate',
  'stageInstanceDelete', 'stageInstanceUpdate', 'stickerCreate', 'stickerDelete', 'stickerUpdate', 'scheduledEventCreate', 'scheduledEventDelete', 'scheduledEventUpdate',
  'messageCreateInviteLog', 'messageCreateMessageLinks',
]);
// What is still processed in critical: interactions, commands, moderation, tickets, verification, the guards of the server and the start of the bot.
const ESSENTIAL_EVENT = /^(interactionCreate|ready|guildCreate|guildDelete|messageCreate(Commands|Ticket|AntiScam|AntiNuke|Automod|MediaOnly)|guildMemberAdd(Verification|Jail|AntiRaid|AntiAlt|AntiNukeBot|Poj)|guildMemberUpdateJail|channelCreateJail|guildBan|voiceMaster|channelDeleteTicket)|AntiNuke|Ticket/;

const essentialEvent = (file) => ESSENTIAL_EVENT.test(String(file ?? ''));

/** The thresholds a metric trips: `{ loop: [degraded, critical], restWait: [..], restQueue: [..], rssPercent: [..] }`. */
function createBreaker({ thresholds, calmMs = 90_000, now = () => Date.now(), onChange = () => {} } = {}) {
  let level = 'normal';
  let since = now();
  let reason = null;
  let calmSince = null;
  let forced = null;
  const history = []; // { at, from, to, reason }

  function trip(metrics) {
    let target = 'normal';
    let why = null;
    const rules = [
      ['event loop p99', metrics.loopP99Ms, thresholds.loop, 'ms'],
      ['longest wait of a request to Discord', metrics.restWaitMs, thresholds.restWait, 'ms'],
      ['requests waiting for Discord', metrics.restQueued, thresholds.restQueue, ''],
      ['memory of the process', metrics.rssPercent, thresholds.rssPercent, '% of the limit'],
    ];
    for (const [label, value, [degraded, critical], unit] of rules) {
      if (!Number.isFinite(value) || !Number.isFinite(degraded)) continue;
      const rank = value >= critical ? 2 : value >= degraded ? 1 : 0;
      if (rank > RANK[target]) { target = LEVELS[rank]; why = `${label} ${Math.round(value)}${unit ? ` ${unit}` : ''} (limit ${rank === 2 ? critical : degraded})`; }
    }
    return { target, why };
  }

  function change(to, why) {
    const from = level;
    if (from === to) return;
    level = to;
    since = now();
    reason = why;
    calmSince = null;
    history.push({ at: since, from, to, reason: why });
    if (history.length > 50) history.shift();
    try { onChange({ from, to, reason: why, since }); } catch { /* an alert that fails never stops the guard */ }
  }

  return {
    /** One look at the numbers. Up at once, down one step after `calmMs` of calm. Returns the level. */
    evaluate(metrics) {
      if (forced) return level;
      const { target, why } = trip(metrics);
      if (RANK[target] > RANK[level]) { change(target, why); return level; }
      if (RANK[target] === RANK[level]) { calmSince = null; if (target !== 'normal' && why) reason = why; return level; }
      // Calmer than the level: it must stay so for a while.
      calmSince ??= now();
      if (now() - calmSince >= calmMs) change(LEVELS[RANK[level] - 1], `calm for ${Math.round(calmMs / 1000)} s`);
      return level;
    },
    /** For the owner: `normal`, `degraded` or `critical` fixes the level, `auto` (or null) gives it back to the numbers. */
    force(next) {
      if (!next || next === 'auto') { forced = null; calmSince = null; return level; }
      if (!(next in RANK)) throw new Error(`Unknown level ${next}`); // i18n-ignore: internal
      forced = next;
      change(next, 'forced by the team');
      return level;
    },
    state: () => ({ level, since, reason, forced, calmSince, history: history.slice(-10) }),
    level: () => level,
  };
}

let breaker = null;
let timer = null;
const shedCounts = new Map(); // kind -> total
const shedRecent = []; // { at, kind }
let metricsReader = null;
let dropCachesHook = null;
let alertSink = null;

function noteShed(kind) {
  shedCounts.set(kind, (shedCounts.get(kind) ?? 0) + 1);
  shedRecent.push({ at: Date.now(), kind });
  if (shedRecent.length > 2000) shedRecent.splice(0, shedRecent.length - 1000);
}

/** The numbers the breaker looks at, from what utils/perf.js measures. */
function readMetrics() {
  const perf = require('./perf');
  const config = require('../config');
  const loop = perf.loopStats();
  const gate = perf.restStats().gateState;
  const recentP99 = Math.max(loop.live?.p99 ?? 0, loop.series.at(-1)?.p99 ?? 0);
  return {
    loopP99Ms: recentP99,
    restWaitMs: gate?.oldestNormalMs ?? 0,
    restQueued: (gate?.queuedNormal ?? 0) + (gate?.queuedHigh ?? 0),
    rssPercent: (process.memoryUsage().rss / 1048576) / config.memoryLimitMb * 100,
  };
}

function ensureBreaker() {
  if (breaker) return breaker;
  const config = require('../config');
  breaker = createBreaker({
    thresholds: {
      loop: [config.guardLoopDegradedMs, config.guardLoopCriticalMs],
      restWait: [config.guardRestWaitDegradedMs, config.guardRestWaitCriticalMs],
      restQueue: [config.guardRestQueueDegraded, config.guardRestQueueCritical],
      rssPercent: [80, 92],
    },
    calmMs: config.guardCalmSeconds * 1000,
    onChange: (change) => announce(change),
  });
  return breaker;
}

/** One alert for each change of level: a priority error when it goes up, a warning when it comes down. */
function announce({ from, to, reason, since }) {
  const text = `[load guard] The bot went from ${from} to ${to}: ${reason}. Since ${new Date(since).toISOString()}.`;
  if (alertSink) { try { alertSink({ from, to, reason, since, text }); } catch { /* the alert is best effort */ } return; }
  if (RANK[to] > RANK[from]) logger.error(text);
  else logger.warn(text);
}

/** Starts looking every 5 seconds. `reader` replaces the real metrics (for the checks). */
function start({ reader = null, every = TICK_MS } = {}) {
  const config = require('../config');
  if (!config.guardEnabled && !reader) return false;
  metricsReader = reader;
  ensureBreaker();
  if (timer) clearInterval(timer);
  timer = setInterval(() => { try { tick(); } catch { /* a look that fails is skipped */ } }, every);
  timer.unref?.();
  return true;
}

function tick() {
  return ensureBreaker().evaluate((metricsReader ?? readMetrics)());
}

function stop() { if (timer) clearInterval(timer); timer = null; }

const level = () => (breaker ? breaker.level() : 'normal');
const isDegraded = () => level() !== 'normal';

/** Whether an interval job may run now; a shed one counts. `name` is the file of the job (`feedsJob`). */
function allowsJob(name) {
  const current = level();
  if (current === 'normal') return true;
  const allowed = ESSENTIAL_JOBS.has(name) || (current === 'degraded' && !SHED_IN_DEGRADED_JOBS.has(name));
  if (!allowed) noteShed(`job:${name}`);
  return allowed;
}

/** Whether a listener of a gateway event may run now (`file` is the file of the listener, `messageCreateLevelXp`). */
function allowsEvent(file) {
  const current = level();
  if (current === 'normal') return true;
  const allowed = essentialEvent(file) || (current === 'degraded' && !SHED_IN_DEGRADED_EVENTS.has(file));
  if (!allowed) noteShed(`event:${file}`);
  return allowed;
}

/** Whether an optional feature may run ('image-render', 'optional-log'...): only in normal mode. */
function allowsOptional(kind) {
  if (level() === 'normal') return true;
  noteShed(`optional:${kind}`);
  return false;
}

/** How many times longer the sticky messages wait before they go back to the bottom. */
const stickyFactor = () => ({ normal: 1, degraded: 4, critical: 8 })[level()];

/** What essential work still runs in each level, for `!perf limits` and the checks. */
function policy() {
  return { essentialJobs: [...ESSENTIAL_JOBS], degradedJobs: [...SHED_IN_DEGRADED_JOBS], degradedEvents: [...SHED_IN_DEGRADED_EVENTS], essentialEvent: ESSENTIAL_EVENT.source };
}

function stats() {
  const hour = Date.now() - 3_600_000;
  const recent = {};
  for (const entry of shedRecent) if (entry.at >= hour) recent[entry.kind] = (recent[entry.kind] ?? 0) + 1;
  return { ...ensureBreaker().state(), shed: Object.fromEntries(shedCounts), shedLastHour: recent };
}

const force = (next) => ensureBreaker().force(next);
const setAlertSink = (sink) => { alertSink = sink; };
const setDropCaches = (hook) => { dropCachesHook = hook; };
function dropCaches() { try { return dropCachesHook ? dropCachesHook() : 0; } catch { return 0; } }

/** For the checks: a clean guard. */
function reset() { stop(); breaker = null; shedCounts.clear(); shedRecent.length = 0; metricsReader = null; alertSink = null; }

module.exports = {
  LEVELS, createBreaker, essentialEvent,
  start, stop, tick, level, isDegraded, allowsJob, allowsEvent, allowsOptional, stickyFactor, policy, stats, force, setAlertSink, setDropCaches, dropCaches, readMetrics, reset,
};
