// The optional Redis of the bot (REDIS_URL or DISCLOUD_REDIS_URL). Everything here is a helper that can say "nothing": with no Redis,
// while it connects, or while it is down, each call answers right away with its fallback, so the bot never waits on it or breaks.
const logger = require('./logger');

// Loaded when first needed: the caches that can use Redis are also used by checks that run without any configuration.
const config = new Proxy({}, { get: (_, key) => require('../config')[key], set: (_, key, value) => { require('../config')[key] = value; return true; } });

const PREFIX = 'petto:';
const TIMEOUT_MS = 300; // a Redis that does not answer this fast is as good as down for that call
const BACKOFF_MS = 10_000; // after a failure it is not asked again for a while

let client = null;
let ready = false;
let downUntil = 0;
let lastWarnAt = 0;

function enabled() { return Boolean(config.redisUrl); }

function warn(message) {
  if (Date.now() - lastWarnAt < 60_000) return;
  lastWarnAt = Date.now();
  logger.warn(`[Redis] ${message}`);
}

function start() {
  if (!enabled() || client) return;
  client = require('redis').createClient({ url: config.redisUrl, socket: { connectTimeout: 5_000, reconnectStrategy: (attempt) => Math.min(attempt * 500, 10_000) } });
  client.on('ready', () => { ready = true; downUntil = 0; logger.info('[Redis] connected.'); });
  client.on('end', () => { ready = false; });
  client.on('error', (error) => { ready = false; warn(`connection problem: ${error?.message ?? error}`); });
  client.connect().catch((error) => warn(`could not connect: ${error?.message ?? error}`));
}

function available() { return enabled() && ready && Date.now() >= downUntil; }

async function run(action, fallback) {
  if (!available()) return fallback;
  let timer;
  try {
    return await Promise.race([
      action(client),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS); }),
    ]);
  } catch (error) {
    downUntil = Date.now() + BACKOFF_MS;
    warn(`a command failed (${error?.message ?? error}); skipping Redis for ${BACKOFF_MS / 1000}s.`);
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
