// Who some members of a server are (name, avatar, bot or not), for the dashboard pages that show people (logs, leaderboards,
// tickets). The dashboard used to ask Discord's REST API one member at a time with the bot token on every page; this answers
// from what the bot already has in memory, then from a 10 minute cache (Redis, or this process without it), and asks Discord for
// the rest in ONE gateway request (Request Guild Members, which spends none of the REST limit). People who are not in the server
// are left out: nothing here calls REST.
const redis = require('./redis');
const logger = require('./logger');

const MAX_IDS = 100; // what one Request Guild Members accepts
const SNOWFLAKE = /^\d{15,25}$/;
const CACHE_TTL_MS = 10 * 60_000;
const MISSING_TTL_MS = 2 * 60_000; // someone who is not in the server is not asked for again for a while (kept in this process only)
const LOCAL_MAX = 5_000;
const FETCH_TIMEOUT_MS = 10_000;

const cacheKey = (guildId, userId) => `members:${guildId}:${userId}`; // petto:members:<guild>:<user>

/** A small LRU in this process: the cache when there is no Redis, and the first place looked otherwise. */
function createLru(max) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expiresAt <= Date.now()) return undefined;
      entries.set(key, entry); // most recently used goes last
      return entry.value;
    },
    set(key, value, ttlMs) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      while (entries.size > max) entries.delete(entries.keys().next().value);
    },
    clear() { entries.clear(); },
    get size() { return entries.size; },
  };
}

const local = createLru(LOCAL_MAX);
const missing = createLru(LOCAL_MAX);

/**
 * Reads `ids` from a request body: an array of at most 100 snowflakes (as strings). Duplicates are dropped.
 * `{ ok: true, ids }` or `{ ok: false, error }` with `invalid_ids` / `too_many_ids`.
 */
function parseMemberIds(raw) {
  if (!Array.isArray(raw)) return { ok: false, error: 'invalid_ids' };
  if (raw.length > MAX_IDS) return { ok: false, error: 'too_many_ids' };
  if (!raw.every((id) => typeof id === 'string' && SNOWFLAKE.test(id))) return { ok: false, error: 'invalid_ids' };
  return { ok: true, ids: [...new Set(raw)] };
}

const urlOf = (target) => (typeof target?.avatarURL === 'function' ? target.avatarURL() : null) ?? null;

/** What the dashboard is told about one member. */
function memberCard(member) {
  const user = member.user ?? {};
  return {
    id: String(member.id ?? user.id),
    username: user.username ?? null,
    globalName: user.globalName ?? null,
    displayName: member.displayName ?? member.nickname ?? user.globalName ?? user.username ?? null,
    // The server avatar of the member, or their own; null when they have the default one.
    avatar: urlOf(member) ?? urlOf(user),
    bot: Boolean(user.bot),
  };
}

async function remember(guildId, cards) {
  for (const card of cards) local.set(cacheKey(guildId, card.id), card, CACHE_TTL_MS);
  if (!redis.available()) return;
  await Promise.all(cards.map((card) => redis.setJson(cacheKey(guildId, card.id), card, CACHE_TTL_MS)));
}

/**
 * The members of `guild` among `ids`, as `{ [id]: card }`. Ids that are not members are left out. Order of the sources: the
 * gateway cache of discord.js, the 10 minute cache, then one `guild.members.fetch({ user: [...] })` for what is left.
 */
async function lookupMembers(guild, ids) {
  const guildId = String(guild.id);
  const found = {};
  let left = [];
  for (const id of ids) {
    const member = guild.members?.cache?.get(id);
    if (member && !member.partial) found[id] = memberCard(member);
    else if (local.get(cacheKey(guildId, id))) found[id] = local.get(cacheKey(guildId, id));
    else if (!missing.get(cacheKey(guildId, id))) left.push(id);
  }

  if (left.length) {
    const shared = await redis.getJsonMany(left.map((id) => cacheKey(guildId, id)));
    left = left.filter((id) => {
      const card = shared.get(cacheKey(guildId, id));
      if (!card || typeof card !== 'object') return true;
      found[id] = card;
      local.set(cacheKey(guildId, id), card, CACHE_TTL_MS);
      return false;
    });
  }

  if (left.length) {
    try {
      // An array of users always goes through the gateway (opcode 8), never REST.
      const fetched = await guild.members.fetch({ user: left, time: FETCH_TIMEOUT_MS });
      const cards = [];
      for (const member of fetched?.values?.() ?? []) {
        const card = memberCard(member);
        if (!left.includes(card.id)) continue;
        found[card.id] = card;
        cards.push(card);
      }
      for (const id of left) if (!found[id]) missing.set(cacheKey(guildId, id), true, MISSING_TTL_MS);
      await remember(guildId, cards);
    } catch (error) {
      // A gateway rate limit or a timeout: answer with what there is; the page shows ids for the rest.
      logger.warn(`[members] could not fetch ${left.length} member(s) of ${guildId}: ${error?.message ?? error}`);
    }
  }
  return found;
}

module.exports = { MAX_IDS, CACHE_TTL_MS, parseMemberIds, memberCard, lookupMembers, _local: local, _missing: missing };
