// i18n-ignore-file: database layer; nothing here reaches a member.
// The servers the Petto team blacklisted (table guild_blacklist in schema.sql) and the copy of them that Petto keeps in memory.
//
// A server on the list is one that broke the terms of service or the privacy policy: Petto leaves it, and leaves again the second it is added back.
// `isBlacklisted(guildId)` is what every door of the bot asks (every event, every web route), so it NEVER touches the database: it reads a Map that is
// loaded at start (`load`), made again after every change this process makes, and again every few minutes (`startRefresh`) so a change made by another
// process is seen too. The optional environment variable PETTO_BLACKLISTED_GUILD_IDS is merged in on every load as a safety net: it can add, never remove.
const config = require('../config');

const SNOWFLAKE = /^\d{15,25}$/;
const REFRESH_MS = 5 * 60 * 1000;

/** The statements, exported so the checks can assert what they say. */
const SQL = Object.freeze({
  all: 'select * from guild_blacklist order by added_at desc, guild_id',
  get: 'select * from guild_blacklist where guild_id = $1',
  insert: `insert into guild_blacklist (guild_id, reason, added_by, guild_name, owner_id)
values ($1, $2, $3, $4, $5)
on conflict (guild_id) do nothing
returning *`,
  remove: 'delete from guild_blacklist where guild_id = $1 returning *',
  notified: 'update guild_blacklist set notified_at = now() where guild_id = $1 returning *',
  left: 'update guild_blacklist set left_at = now() where guild_id = $1 returning *',
  attempt: 'update guild_blacklist set attempts = attempts + 1, last_attempt_at = now() where guild_id = $1 returning *',
});

/** The row that stands for an id of the environment variable (it has no row in the table). */
const envRow = (guildId) => ({
  guild_id: guildId, reason: 'Listed by the host (the environment).', added_by: 'environment', added_at: null, guild_name: null, owner_id: null,
  notified_at: null, left_at: null, attempts: 0, last_attempt_at: null, fromEnvironment: true,
});

/**
 * The store over a `query(sql, params)` function (the pool of the bot, or a fake in the checks) and the memory of it.
 * `envIds` is a function so the checks can change what the environment says.
 */
function createStore(query, { envIds = () => config.blacklistedGuildIds ?? [], protectedIds = () => [config.supportGuildId, config.opsGuildId], now = () => Date.now() } = {}) {
  let cache = new Map(); // guildId -> row (the database ones win over the environment ones)
  let loaded = false;
  let timer = null;

  const remember = (row) => { if (row?.guild_id) cache.set(String(row.guild_id), row); return row ?? null; };
  // The support and operations servers are never on the list, whatever the environment or the table say (the team would lose its own tools).
  const spared = () => new Set(protectedIds().filter(Boolean).map(String));
  const environment = () => envIds().filter((id) => SNOWFLAKE.test(String(id)) && !spared().has(String(id))).map(String);

  /** Runs an update that returns the row; an id that only the environment lists has no row, so its counters live in memory. */
  const update = async (sql, id, patch) => {
    const row = (await query(sql, [id])).rows?.[0];
    if (row) return remember(row);
    const fromEnvironment = cache.get(id);
    if (!fromEnvironment?.fromEnvironment) return null;
    Object.assign(fromEnvironment, patch(fromEnvironment));
    return fromEnvironment;
  };

  const store = {
    /** Reads the whole table into memory (and merges the environment). A database that cannot be read keeps what was loaded and still has the environment. */
    async load() {
      let rows = null;
      try { rows = (await query(SQL.all, [])).rows ?? []; } catch (error) { store.lastError = error; }
      const next = new Map();
      for (const id of environment()) next.set(id, envRow(id));
      for (const row of rows ?? [...cache.values()].filter((entry) => !entry.fromEnvironment)) if (!spared().has(String(row.guild_id))) next.set(String(row.guild_id), row);
      cache = next;
      loaded = rows !== null || loaded;
      if (rows !== null) store.lastError = null;
      return cache.size;
    },
    /** A check on every few minutes in the background; never keeps the process alive. */
    startRefresh(interval = REFRESH_MS) {
      if (timer) return timer;
      timer = setInterval(() => { store.load().catch(() => {}); }, interval);
      timer.unref?.();
      return timer;
    },
    stopRefresh() { if (timer) clearInterval(timer); timer = null; },
    /** From memory, at once, never the database: is this server blacklisted? */
    isBlacklisted(guildId) { return cache.has(String(guildId ?? '')); },
    /** The entry of a server from memory, or null. */
    entryOf(guildId) { return cache.get(String(guildId ?? '')) ?? null; },
    /** Every entry in memory, newest first (the ones of the environment last). */
    entries() { return [...cache.values()].sort((a, b) => (b.added_at ? new Date(b.added_at).getTime() : 0) - (a.added_at ? new Date(a.added_at).getTime() : 0)); },
    get loaded() { return loaded; },
    lastError: null,

    /** Adds a server: `{ created: true, row }`, or `{ created: false, row }` when it was already there (nothing is changed). */
    async add({ guildId, reason, addedBy, guildName = null, ownerId = null }) {
      const id = String(guildId);
      const { rows } = await query(SQL.insert, [id, String(reason), String(addedBy), guildName ?? null, ownerId ?? null]);
      if (rows?.[0]) return { created: true, row: remember(rows[0]) };
      const existing = (await query(SQL.get, [id])).rows?.[0] ?? cache.get(id) ?? null;
      return { created: false, row: remember(existing) };
    },
    /** Removes a server: the row that was removed, or null. The environment is not the table: an id of the environment stays until it is taken out there. */
    async remove(guildId) {
      const id = String(guildId);
      const row = (await query(SQL.remove, [id])).rows?.[0] ?? null;
      const fromEnvironment = environment().includes(id);
      if (fromEnvironment) cache.set(id, envRow(id)); else cache.delete(id);
      return { row, stillByEnvironment: fromEnvironment };
    },
    async get(guildId) { return (await query(SQL.get, [String(guildId)])).rows?.[0] ?? cache.get(String(guildId)) ?? null; },
    async list() { await store.load(); return store.entries(); },
    /** The owner was told (one notice every 24 hours at most): written down. */
    async markNotified(guildId) { return update(SQL.notified, String(guildId), () => ({ notified_at: new Date(now()) })); },
    async markLeft(guildId) { return update(SQL.left, String(guildId), () => ({ left_at: new Date(now()) })); },
    /** One more time that the server added Petto again: the row with the new count. */
    async recordAttempt(guildId) { return update(SQL.attempt, String(guildId), (row) => ({ attempts: (row.attempts ?? 0) + 1, last_attempt_at: new Date(now()) })); },
    now,
  };
  return store;
}

/** The store of the bot (the pool is asked for when a query runs), with the statements and the factory next to its functions. */
const store = createStore((sql, params) => require('./postgres').getPrimaryPool().query(sql, params));

module.exports = Object.assign(store, { SQL, SNOWFLAKE, createStore, envRow });
