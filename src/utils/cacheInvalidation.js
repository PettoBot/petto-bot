// Forgets cached configuration when the dashboard changes it. The dashboard writes to PostgreSQL directly, so without this a
// cache keeps the old value until it expires (15-30 s). After a write the dashboard publishes on the Redis channel
// `petto:invalidate` a JSON message `{ "table": "<postgres table>", "guildId": "<id>" }`; every bot process listening forgets that
// server's entry in each cache that reads that table, in its memory and in the Redis copy.
//
// This file is the one place that says which table reaches which cache: each cache registers the tables it reads (the
// `invalidateOn` option of createExpiringCache), and INVALIDATION_TABLES lists every table this understands. Without Redis nothing
// arrives, and the caches simply expire as they always did.
const logger = require('./logger');

const INVALIDATION_CHANNEL = 'invalidate'; // petto:invalidate

/** Every table the dashboard may name in a message, and the cache that reads it. Keep it in step with the `invalidateOn` options. */
const INVALIDATION_TABLES = Object.freeze([
  'automod_config', // src/db/automod.js, the automod settings of a server
  'automod_silent_channels', // src/db/automod.js, channels where automod acts without a message
  'button_responders', // src/db/responders.js, button responders (cached by responder id)
  'level_config', // src/db/levelConfig.js
  'level_multipliers', // src/db/levelMultipliers.js
  'partner_config', // src/db/partners.js
  'sanction_templates', // src/db/sanctionTemplates.js
  'sticky_messages', // src/db/stickyMessages.js (cached by server and channel)
  'ticket_settings', // src/db/ticketSettings.js
  'upload_config', // src/db/uploads.js
  'xp_events', // src/db/xpEvents.js
]);

const SNOWFLAKE = /^\d{15,25}$/;
const registry = new Map(); // table -> Set of (guildId) => void

/**
 * How a cache finds the entries of one server:
 * - 'guild' (the default): the key is the server id;
 * - 'prefix': the key starts with `<server id>:`;
 * - a function `(key, value, guildId) => boolean` for anything else.
 */
function matcherFor(match, guildId) {
  if (typeof match === 'function') return (key, value) => Boolean(match(key, value, guildId));
  if (match === 'prefix') return (key) => key.startsWith(`${guildId}:`);
  return null;
}

/** Registers a cache made with createExpiringCache for the tables it reads. Unknown table names are a mistake in the code. */
function registerCache(cache, tables, { match = 'guild' } = {}) {
  for (const table of tables) {
    if (!INVALIDATION_TABLES.includes(table)) throw new Error(`cacheInvalidation: "${table}" is not in INVALIDATION_TABLES`);
    if (!registry.has(table)) registry.set(table, new Set());
    registry.get(table).add((guildId) => {
      const matches = matcherFor(match, guildId);
      if (matches) cache.deleteWhere(matches);
      else cache.delete(guildId);
    });
  }
}

/** Forgets what the caches that read `table` hold for `guildId`. Answers how many caches were told (0 for an unknown table). */
function invalidate(table, guildId) {
  const invalidators = registry.get(String(table));
  if (!invalidators || !SNOWFLAKE.test(String(guildId ?? ''))) return 0;
  for (const forget of invalidators) forget(String(guildId));
  return invalidators.size;
}

/** One message of `petto:invalidate`. Broken or unknown messages are ignored. */
function handleInvalidationMessage(raw) {
  let message;
  try { message = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return 0; }
  if (!message || typeof message !== 'object') return 0;
  return invalidate(message.table, message.guildId);
}

/** The tables that have at least one cache loaded in this process (the bot loads every module at start). */
function registeredTables() {
  return [...registry.keys()].sort();
}

let listening = false;
/** Listens on `petto:invalidate`. False without Redis. */
function startCacheInvalidation() {
  if (listening) return true;
  listening = require('./redis').subscribe(INVALIDATION_CHANNEL, handleInvalidationMessage);
  if (listening) logger.info(`[cache] listening for dashboard changes on petto:${INVALIDATION_CHANNEL}.`);
  return listening;
}

module.exports = {
  INVALIDATION_CHANNEL,
  INVALIDATION_TABLES,
  registerCache,
  invalidate,
  handleInvalidationMessage,
  registeredTables,
  startCacheInvalidation,
};
