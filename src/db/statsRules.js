// What the statistics may count. Two things decide it: what a server turned off (`stats_config`) and the people who asked not to be counted
// anywhere (`stats_optout`). Both are small, so they are kept in memory and read again every minute; asking is then free for every message.
// Until they have been read once nothing is counted, so a person who opted out is never counted for the first seconds after a restart.
const database = require('./database');
const { ensureGuild } = require('./guilds');
const logger = require('../utils/logger');

const REFRESH_MS = 60_000;
const PAGE = 1000;
const DEFAULTS = Object.freeze({ enabled: true, members: true, content: true });

let configs = new Map(); // guildId -> { enabled, members, content } (only the servers that changed something)
let optedOut = new Set();
let loadedAt = 0;
let loading = null;

async function readAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await database.from(table).select(columns).order(columns.split(',')[0].trim(), { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

/** Reads the rules again. A failure keeps the last ones. */
async function load() {
  if (loading) return loading;
  loading = (async () => {
    const [configRows, optOutRows] = await Promise.all([
      readAll('stats_config', 'guild_id,enabled,members_enabled,content_enabled'),
      readAll('stats_optout', 'user_id'),
    ]);
    configs = new Map(configRows.map((row) => [row.guild_id, { enabled: row.enabled !== false, members: row.members_enabled !== false, content: row.content_enabled !== false }]));
    optedOut = new Set(optOutRows.map((row) => row.user_id));
    loadedAt = Date.now();
  })().catch((error) => { logger.warn(`[Stats rules] Could not read them, keeping the last ones: ${error.message}`); }).finally(() => { loading = null; });
  return loading;
}

function refreshSoon() {
  if (!loading && Date.now() - loadedAt > REFRESH_MS) load();
}

/** What a server counts: { enabled, members, content }. */
function rulesOf(guildId) {
  return configs.get(guildId) ?? DEFAULTS;
}

/**
 * Is this server counted at all, and may it keep counts per member? Answers `null` when nothing may be counted (the server turned it off, the person
 * asked not to be counted, or the rules were not read yet), else `{ members, content }`. `userId` is the person the activity belongs to (null for
 * activity that has no person).
 */
function allowed(guildId, userId = null) {
  refreshSoon();
  if (!loadedAt) return null;
  const rules = rulesOf(guildId);
  if (!rules.enabled) return null;
  if (userId && optedOut.has(userId)) return null;
  return { members: rules.members, content: rules.content };
}

const isOptedOut = (userId) => optedOut.has(userId);

/** The stored rules of a server (the defaults for one that never changed anything). */
async function getConfig(guildId) {
  const { data, error } = await database.from('stats_config').select('enabled,members_enabled,content_enabled').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data ? { enabled: data.enabled !== false, members: data.members_enabled !== false, content: data.content_enabled !== false } : { ...DEFAULTS };
}

/** Saves some of the rules of a server (`enabled`, `members`, `content`) and applies them at once. */
async function setConfig(guildId, patch) {
  await ensureGuild(guildId);
  const next = { ...(await getConfig(guildId)), ...patch };
  const { error } = await database.from('stats_config').upsert({
    guild_id: guildId, enabled: next.enabled, members_enabled: next.members, content_enabled: next.content, updated_at: new Date().toISOString(),
  }, { onConflict: 'guild_id' });
  if (error) throw error;
  configs.set(guildId, next);
  return next;
}

/** A person is counted again (`false`) or is left out of every server (`true`); leaving out also deletes what was counted per member about them. */
async function setOptOut(userId, value) {
  if (value) {
    const { error } = await database.from('stats_optout').upsert({ user_id: userId }, { onConflict: 'user_id' });
    if (error) throw error;
    optedOut.add(userId);
    await deleteMemberCounts(userId);
  } else {
    const { error } = await database.from('stats_optout').delete().eq('user_id', userId);
    if (error) throw error;
    optedOut.delete(userId);
  }
}

/** Deletes what was counted per member about one person, in every server. Returns how many days of counts went. */
async function deleteMemberCounts(userId) {
  const { data, error } = await database.from('activity_members').delete().eq('user_id', userId).select('day');
  if (error) throw error;
  return (data ?? []).length;
}

const GUILD_TABLES = ['activity_stats', 'activity_hourly', 'activity_members', 'member_flow', 'activity_content', 'member_lifespan'];

/** Deletes every counter of a server. Returns how many rows went. */
async function deleteGuildCounts(guildId) {
  let total = 0;
  for (const table of GUILD_TABLES) {
    const { data, error } = await database.from(table).delete().eq('guild_id', guildId).select('guild_id');
    if (error) throw error;
    total += (data ?? []).length;
  }
  return total;
}

// How long the counters are kept: per member for 13 months, the totals of a day for two years.
const KEEP_MEMBER_DAYS = 400;
const KEEP_TOTAL_DAYS = 730;
const dayBefore = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Deletes the counters older than they are kept. */
async function pruneOld() {
  const limits = [['activity_members', KEEP_MEMBER_DAYS]].concat(GUILD_TABLES.filter((table) => table !== 'activity_members').map((table) => [table, KEEP_TOTAL_DAYS]));
  for (const [table, days] of limits) {
    const { error } = await database.from(table).delete().lt('day', dayBefore(days));
    if (error) throw error;
  }
}

/** Only for the checks: sets the rules without the database. */
function setForTests({ configs: nextConfigs = new Map(), optedOut: nextOptedOut = new Set() } = {}) {
  configs = nextConfigs;
  optedOut = nextOptedOut;
  loadedAt = Date.now() + 365 * 86_400_000;
}

module.exports = { DEFAULTS, KEEP_MEMBER_DAYS, KEEP_TOTAL_DAYS, load, allowed, rulesOf, isOptedOut, getConfig, setConfig, setOptOut, deleteMemberCounts, deleteGuildCounts, pruneOld, setForTests };
