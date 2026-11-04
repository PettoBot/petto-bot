// i18n-ignore-file: internal limits (no text for members; the notice is a reaction).
// Limits for the commands people type (the prefix path) and a cap on the commands running at once, so a busy minute in one of the servers
// cannot take the whole bot down:
//   - a bucket of tokens for each person (a burst, then one more every few seconds) and for each server;
//   - a cap of commands running at once (slash commands included) with a short, bounded line, and a share of it kept for staff;
//   - the owner and the developers (PETTO_DEVELOPER_IDS) are never limited; staff (Manage Messages, Moderate Members, Ban Members or Administrator
//     in that server) get three times the limits and the reserved share;
//   - a command that is dropped says so once (a small reaction, at most once for a person every 30 seconds), never once for each dropped message.
// When the bot is degraded (utils/loadGuard.js) the buckets are halved; when it is critical only staff and the team are served.
const { PermissionFlagsBits } = require('discord.js');

const STAFF_MULTIPLIER = 3;
const NOTICE_EVERY_MS = 30_000;
const NOTICE_BURST = 5; // at most this many notices in any 10 seconds for the whole bot
const NOTICE_WINDOW_MS = 10_000;
const STAFF_PERMISSIONS = [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.Administrator];

/** Whether a member has one of the permissions of the staff in the server they are in. */
function isStaffMember(member) {
  const permissions = member?.permissions;
  if (!permissions || typeof permissions.has !== 'function') return false;
  try { return STAFF_PERMISSIONS.some((flag) => permissions.has(flag) === true); } catch { return false; }
}

/** Buckets by key: `take(key, { scale })` -> { ok, retryAfterMs }. The capacity and the refill of a bucket are scaled when it is asked (staff, degraded mode). */
function createBucketStore({ burst, refillPerSecond, now = () => Date.now(), maxKeys = 20_000 } = {}) {
  const buckets = new Map(); // key -> { tokens, at }
  function prune() {
    const current = now();
    for (const [key, bucket] of buckets) if (current - bucket.at > 120_000) buckets.delete(key);
    if (buckets.size > maxKeys) for (const key of buckets.keys()) { buckets.delete(key); if (buckets.size <= maxKeys / 2) break; }
  }
  return {
    take(key, { scale = 1 } = {}) {
      const capacity = Math.max(1, burst * scale);
      const rate = Math.max(0.001, refillPerSecond * scale) / 1000;
      const current = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxKeys) prune();
        bucket = { tokens: capacity, at: current };
        buckets.set(key, bucket);
      }
      bucket.tokens = Math.min(capacity, bucket.tokens + (current - bucket.at) * rate);
      bucket.at = current;
      if (bucket.tokens >= 1) { bucket.tokens -= 1; return { ok: true, retryAfterMs: 0 }; }
      return { ok: false, retryAfterMs: Math.ceil((1 - bucket.tokens) / rate) };
    },
    size: () => buckets.size,
  };
}

/** The cap of commands running at once, with a bounded line and a share for staff. */
function createSemaphore({ max, queue, staffReserve, maxWaitMs, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const limit = Math.max(1, max);
  const reserve = Math.min(Math.max(0, staffReserve), limit - 1);
  let running = 0;
  const waiting = []; // { staff, resolve, timer, at }
  const drops = { full: 0, timeout: 0 };
  const canStart = (staff) => running < (staff ? limit : limit - reserve);

  function start() {
    running += 1;
    let released = false;
    return () => { if (released) return; released = true; running -= 1; pump(); };
  }
  function pump() {
    // Staff first; then everybody else, in order.
    for (const staff of [true, false]) {
      for (let index = 0; index < waiting.length;) {
        const waiter = waiting[index];
        if (waiter.staff === staff && canStart(staff)) {
          waiting.splice(index, 1);
          clearTimer(waiter.timer);
          waiter.resolve({ ok: true, waitedMs: now() - waiter.at, release: start() });
        } else index += 1;
      }
    }
  }
  return {
    /** Resolves `{ ok: true, release, waitedMs }` when the command may run, or `{ ok: false, reason: 'full' | 'timeout' }`. The team is `staff: true`. */
    acquire({ staff = false, maxWaitMs: ownWaitMs = maxWaitMs } = {}) {
      if (canStart(staff) && !waiting.some((waiter) => waiter.staff === staff)) return Promise.resolve({ ok: true, waitedMs: 0, release: start() });
      if (waiting.length >= queue) { drops.full += 1; return Promise.resolve({ ok: false, reason: 'full' }); }
      return new Promise((resolve) => {
        const waiter = { staff, at: now(), resolve, timer: null };
        waiter.timer = setTimer(() => {
          const index = waiting.indexOf(waiter);
          if (index >= 0) waiting.splice(index, 1);
          drops.timeout += 1;
          resolve({ ok: false, reason: 'timeout' });
        }, ownWaitMs);
        waiter.timer?.unref?.();
        waiting.push(waiter);
      });
    },
    stats: () => ({ running, waiting: waiting.length, max: limit, reserve, queue, drops: { ...drops } }),
  };
}

/**
 * The limiter of the commands. `level()` is the level of the load guard ('normal', 'degraded', 'critical'); `isTeam(userId)` tells the owner and
 * the developers; `limits` are the numbers (see config.js, the `PETTO_CMD_*` variables).
 */
function createCommandLimiter({ limits, level = () => 'normal', isTeam = () => false, now = () => Date.now(), onDrop = () => {} } = {}) {
  const users = createBucketStore({ burst: limits.userBurst, refillPerSecond: 1 / limits.userRefillSeconds, now });
  const guilds = createBucketStore({ burst: limits.guildBurst, refillPerSecond: limits.guildRefillPerSecond, now });
  const semaphore = createSemaphore({ max: limits.concurrency, queue: limits.queue, staffReserve: limits.staffReserve, maxWaitMs: limits.queueWaitMs, now });
  const noticedAt = new Map(); // user id -> when they were last told
  const noticeTimes = [];
  const drops = []; // { at, kind } of the last hour
  const totals = { user: 0, guild: 0, critical: 0, global: 0, queue: 0 };

  function drop(kind) {
    totals[kind] = (totals[kind] ?? 0) + 1;
    drops.push({ at: now(), kind });
    const hour = now() - 3_600_000;
    while (drops.length && drops[0].at < hour) drops.shift();
    try { onDrop(kind); } catch { /* counting never breaks a command */ }
  }

  return {
    /** Looks at the buckets for one command typed by a person. Cheap and synchronous: nothing is read from the database. */
    check({ userId, guildId, staff = false }) {
      if (isTeam(userId)) return { ok: true };
      const current = level();
      if (current === 'critical' && !staff) { drop('critical'); return { ok: false, kind: 'critical' }; }
      const scale = (current === 'degraded' ? 0.5 : 1) * (staff ? STAFF_MULTIPLIER : 1);
      if (!users.take(`u:${userId}`, { scale }).ok) { drop('user'); return { ok: false, kind: 'user' }; }
      if (guildId && !guilds.take(`g:${guildId}${staff ? ':staff' : ''}`, { scale }).ok) { drop('guild'); return { ok: false, kind: 'guild' }; }
      return { ok: true };
    },
    /** Waits for a place among the commands running at once (the line is short and bounded). The team and the staff have the reserved share. */
    async acquire({ userId, staff = false, maxWaitMs }) {
      const result = await semaphore.acquire({ staff: staff || isTeam(userId), maxWaitMs });
      if (!result.ok) drop(result.reason === 'full' ? 'queue' : 'global');
      return result;
    },
    /** Whether the person may be told that their command was dropped: once for each person every 30 seconds, and a few for the whole bot. */
    shouldNotify(userId) {
      const current = now();
      if (current - (noticedAt.get(userId) ?? 0) < NOTICE_EVERY_MS) return false;
      while (noticeTimes.length && current - noticeTimes[0] > NOTICE_WINDOW_MS) noticeTimes.shift();
      if (noticeTimes.length >= NOTICE_BURST) return false;
      noticeTimes.push(current);
      noticedAt.set(userId, current);
      if (noticedAt.size > 5_000) for (const [id, at] of noticedAt) if (current - at > NOTICE_EVERY_MS) noticedAt.delete(id);
      return true;
    },
    stats() {
      return { ...semaphore.stats(), totals: { ...totals }, lastHour: drops.reduce((sum, entry) => ({ ...sum, [entry.kind]: (sum[entry.kind] ?? 0) + 1 }), {}), users: users.size(), guilds: guilds.size() };
    },
    limits: () => ({ ...limits }),
  };
}

let shared = null;

/**
 * The limits only apply in the running bot (the process started from index.js) or when PETTO_CMD_LIMITS=on: the checks of scripts/ drive many commands
 * from one fake person in a few milliseconds, which is exactly what a limit refuses. PETTO_CMD_LIMITS=off turns them off in the bot too.
 */
function limitsApply(env = process.env, entry = process.argv[1]) {
  const setting = String(env.PETTO_CMD_LIMITS ?? '').toLowerCase();
  if (setting === 'off') return false;
  if (setting === 'on') return true;
  return /(^|[\\/])index\.js$/.test(String(entry ?? ''));
}

const OPEN = { check: () => ({ ok: true }), acquire: async () => ({ ok: true, waitedMs: 0, release: () => {} }), shouldNotify: () => false, stats: () => ({ running: 0, waiting: 0, max: 0, reserve: 0, queue: 0, drops: {}, totals: {}, lastHour: {}, users: 0, guilds: 0, off: true }), limits: () => ({ off: true }) };

/** The limiter of this process, made from the configuration the first time it is asked. */
function commandLimiter() {
  if (shared) return shared;
  if (!limitsApply()) { shared = OPEN; return shared; }
  const config = require('../config');
  const loadGuard = require('./loadGuard');
  const { isPettoOperator } = require('./autoModControl');
  shared = createCommandLimiter({
    limits: { userBurst: config.cmdUserBurst, userRefillSeconds: config.cmdUserRefillSeconds, guildBurst: config.cmdGuildBurst, guildRefillPerSecond: config.cmdGuildRefillPerSecond, concurrency: config.cmdConcurrency, queue: config.cmdQueue, staffReserve: config.cmdStaffReserve, queueWaitMs: config.cmdQueueWaitSeconds * 1000 },
    level: () => loadGuard.level(),
    isTeam: (userId) => isPettoOperator(String(userId ?? '')),
  });
  return shared;
}

module.exports = { limitsApply, resetForTests: () => { shared = null; }, STAFF_MULTIPLIER, isStaffMember, createBucketStore, createSemaphore, createCommandLimiter, commandLimiter };
