// The optional Redis of the bot (REDIS_URL or DISCLOUD_REDIS_URL). Everything here is a helper that can say "nothing": with no Redis,
// while it connects, or while it is down, each call answers right away with its fallback, so the bot never waits on it or breaks.
const logger = require('./logger');

// Loaded when first needed: the caches that can use Redis are also used by checks that run without any configuration.
const config = new Proxy({}, { get: (_, key) => require('../config')[key], set: (_, key, value) => { require('../config')[key] = value; return true; } });

const PREFIX = 'petto:';
const TIMEOUT_MS = Math.max(100, Number(process.env.PETTO_REDIS_TIMEOUT_MS) || 1_000); // a Redis that does not answer in this time is as good as down for that call
const SLOW_MS = 250; // a Redis whose round trip is longer than this costs more than the database it would save
const PROBE_EVERY_MS = 5 * 60_000;
const BACKOFFS_MS = [10_000, 30_000, 120_000, 300_000]; // after failures it is left alone for longer each time

let client = null;
let ready = false;
let tooSlow = false;
let failures = 0;
let downUntil = 0;
let lastWarnAt = 0;

function enabled() { return Boolean(config.redisUrl); }

function warn(message, everyMs = 30 * 60_000) {
  if (Date.now() - lastWarnAt < everyMs) return;
  lastWarnAt = Date.now();
  logger.warn(`[Redis] ${message}`);
}

/** Measures one round trip. A Redis that is too slow is not used (the bot goes on as it did without it) until a later probe finds it fast. */
async function probe() {
  if (!client || !ready) return;
  const started = Date.now();
  try {
    await Promise.race([client.ping(), new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 3_000).unref?.())]);
  } catch (error) {
    tooSlow = true;
    warn(`it did not answer a ping (${error?.message ?? error}); it is not used for now.`);
    return;
  }
  const took = Date.now() - started;
  const slow = took > SLOW_MS;
  if (slow !== tooSlow || failures === 0) {
    logger.info(slow ? `[Redis] round trip of ${took} ms is too slow to help; it is not used for now.` : `[Redis] in use, round trip of ${took} ms.`);
  }
  tooSlow = slow;
}

function start() {
  if (!enabled() || client) return;
  client = require('redis').createClient({ url: config.redisUrl, socket: { connectTimeout: 5_000, reconnectStrategy: (attempt) => Math.min(attempt * 500, 10_000) } });
  client.on('ready', () => { ready = true; downUntil = 0; failures = 0; probe().catch(() => {}); });
  client.on('end', () => { ready = false; });
  client.on('error', (error) => { ready = false; warn(`connection problem: ${error?.message ?? error}`); });
  client.connect().catch((error) => warn(`could not connect: ${error?.message ?? error}`));
  setInterval(() => probe().catch(() => {}), PROBE_EVERY_MS).unref?.();
}

function available() { return enabled() && ready && !tooSlow && Date.now() >= downUntil; }

async function run(action, fallback) {
  if (!available()) return fallback;
  let timer;
  try {
    const result = await Promise.race([
      action(client),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS); }),
    ]);
    failures = 0;
    return result;
  } catch (error) {
    const wait = BACKOFFS_MS[Math.min(failures, BACKOFFS_MS.length - 1)];
    failures += 1;
    downUntil = Date.now() + wait;
    warn(`a command failed (${error?.message ?? error}); skipping Redis for ${wait / 1000}s.`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** A JSON value kept under a key: `{ hit: true, value }` when it is there, `{ hit: false }` when it is not (or there is no Redis). */
async function getJson(key) {
  const raw = await run((redis) => redis.get(PREFIX + key), null);
  if (raw == null) return { hit: false };
  try { return { hit: true, value: JSON.parse(raw) }; } catch { return { hit: false }; }
}

async function setJson(key, value, ttlMs) {
  let text;
  try { text = JSON.stringify(value === undefined ? null : value); } catch { return false; }
  return run(async (redis) => { await redis.set(PREFIX + key, text, { PX: Math.max(1, Math.floor(ttlMs)) }); return true; }, false);
}

async function del(key) {
  return run(async (redis) => { await redis.del(PREFIX + key); return true; }, false);
}

/**
 * Claims a key for `ttlMs`. Returns 0 when it was free (now claimed) or when there is no Redis, otherwise the milliseconds that are
 * left before it is free again. This is what a cooldown is.
 */
async function claim(key, ttlMs) {
  return run(async (redis) => {
    const taken = await redis.set(PREFIX + key, '1', { NX: true, PX: Math.max(1, Math.floor(ttlMs)) });
    if (taken) return 0;
    const left = await redis.pTTL(PREFIX + key);
    return left > 0 ? left : 0;
  }, 0);
}

/** Counts one use in the current second and answers how many there have been in it (0 without Redis). */
async function countThisSecond(name) {
  const second = Math.floor(Date.now() / 1000);
  return run(async (redis) => {
    const key = `${PREFIX}${name}:${second}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3);
    return count;
  }, 0);
}

module.exports = { enabled, start, available, getJson, setJson, del, claim, countThisSecond };
