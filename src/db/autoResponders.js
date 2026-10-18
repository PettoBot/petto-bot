const crypto = require('crypto');
const database = require('./database');
const { t, currentLanguage } = require('../i18n');
const { getGuildPremium, getGuildLimits, PREMIUM_LIMITS } = require('./premium');

// The most any server can have (Premium). A Free server has fewer: see limitFor, which follows the plan of the server.
const MAX_PER_GUILD = PREMIUM_LIMITS.autoResponders;
const CACHE_TTL_MS = 15_000;
const listCache = new Map();

function generateArId() {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars, same shape as bli's short ids
}

async function countForGuild(guildId) {
  const { count, error } = await database.from('auto_responders').select('id', { count: 'exact', head: true }).eq('guild_id', guildId);
  if (error) throw error;
  return count ?? 0;
}

async function listForGuild(guildId) {
  const { data, error } = await database.from('auto_responders').select('*').eq('guild_id', guildId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function listForGuildCached(guildId) {
  const cached = listCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  try {
    const rows = await listForGuild(guildId);
    listCache.set(guildId, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
    return rows;
  } catch (error) {
    // A short database outage should not disable already-known autoresponders.
    // Reuse the last successful snapshot briefly and try the DB again later.
    if (cached) {
      cached.expiresAt = Date.now() + Math.min(CACHE_TTL_MS, 5_000);
      return cached.rows;
    }
    throw error;
  }
}

function invalidateGuildCache(guildId) {
  listCache.delete(guildId);
}

async function getById(guildId, arId) {
  const { data, error } = await database.from('auto_responders').select('*').eq('guild_id', guildId).eq('ar_id', arId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getByTrigger(guildId, trigger) {
  const { data, error } = await database.from('auto_responders').select('*').eq('guild_id', guildId).ilike('trigger', trigger).maybeSingle();
  if (error) throw error;
  return data;
}

/** How many autoresponders this server can have, by its plan (Free or Premium). */
async function limitFor(guildId) {
  const premium = await getGuildPremium(guildId).catch(() => ({ active: false }));
  return getGuildLimits(premium).autoResponders;
}

async function create(guildId, patch) {
  const [count, max] = await Promise.all([countForGuild(guildId), limitFor(guildId)]);
  if (count >= max) {
    const err = new Error(t(currentLanguage(), 'automation.db.autoresponderLimit', { max }));
    err.userFacing = true;
    throw err;
  }

  const { data, error } = await database.from('auto_responders').insert({ guild_id: guildId, ar_id: generateArId(), ...patch }).select('*').single();
  if (error) throw error;
  invalidateGuildCache(guildId);
  return data;
}

async function update(guildId, arId, patch) {
  const { data, error } = await database.from('auto_responders').update(patch).eq('guild_id', guildId).eq('ar_id', arId).select('*').maybeSingle();
  if (error) throw error;
  invalidateGuildCache(guildId);
  return data;
}

async function removeByTrigger(guildId, trigger) {
  const { data, error } = await database.from('auto_responders').delete().eq('guild_id', guildId).ilike('trigger', trigger).select('id');
  if (error) throw error;
  invalidateGuildCache(guildId);
  return data.length > 0;
}

async function removeAllForGuild(guildId) {
  const { data, error } = await database.from('auto_responders').delete().eq('guild_id', guildId).select('id');
  if (error) throw error;
  invalidateGuildCache(guildId);
  return data.length;
}

module.exports = { MAX_PER_GUILD, limitFor, listForGuild, listForGuildCached, invalidateGuildCache, getById, getByTrigger, create, update, removeByTrigger, removeAllForGuild };
