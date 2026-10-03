const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');

// Every message of a server passes through the partner check, so its settings are kept for a few seconds. Saving them here
// forgets them at once; a change made from the dashboard is seen within the 15 seconds.
const configCache = createExpiringCache(15_000);

const DEFAULTS = {
  enabled: false,
  channel_ids: [],
  manager_role_id: null,
  min_members: 0,
  min_age_days: 0,
  cooldown_days: 0,
  cooldown_minutes: 0,
  welcome_channel_id: null,
  block_nsfw: false,
  blocked_keywords: [],
  keep_original: true,
  react_emoji: null,
  messages: {},
};

async function getConfig(guildId) {
  const { data, error } = await database.from('partner_config').select('*').eq('guild_id', String(guildId)).maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULTS, ...data } : null;
}

/** The settings, from memory when they are recent. */
function getConfigCached(guildId) {
  return configCache.get(guildId, () => getConfig(guildId), { staleIfError: true });
}

async function upsertConfig(guildId, changes) {
  const { data, error } = await database
    .from('partner_config')
    .upsert({ guild_id: String(guildId), ...changes, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  configCache.delete(String(guildId));
  return { ...DEFAULTS, ...data };
}

async function isBlacklisted(guildId, partnerGuildId) {
  const { data, error } = await database.from('partner_blacklist').select('partner_guild_id').eq('guild_id', String(guildId)).eq('partner_guild_id', String(partnerGuildId)).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function listBlacklist(guildId) {
  const { data, error } = await database.from('partner_blacklist').select('*').eq('guild_id', String(guildId)).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data ?? [];
}

async function addBlacklist(guildId, partnerGuildId, note) {
  const { error } = await database.from('partner_blacklist').upsert({ guild_id: String(guildId), partner_guild_id: String(partnerGuildId), note: note ?? null }, { onConflict: 'guild_id,partner_guild_id' });
  if (error) throw error;
}

async function removeBlacklist(guildId, partnerGuildId) {
  const { data, error } = await database.from('partner_blacklist').delete().eq('guild_id', String(guildId)).eq('partner_guild_id', String(partnerGuildId)).select('partner_guild_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** The newest counted partnership with that server, or null (used for the cooldown). */
async function lastWith(guildId, partnerGuildId) {
  const { data, error } = await database.from('partner_log').select('*').eq('guild_id', String(guildId)).eq('partner_guild_id', String(partnerGuildId)).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function addLog(row) {
  const { data, error } = await database
    .from('partner_log')
    .insert({
      guild_id: String(row.guildId), manager_id: String(row.managerId), partner_guild_id: String(row.partnerGuildId),
      partner_name: row.partnerName ?? null, members: row.members ?? null, invite_code: row.inviteCode ?? null,
      channel_id: row.channelId ?? null, message_id: row.messageId ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function removeLog(guildId, id) {
  const { data, error } = await database.from('partner_log').delete().eq('guild_id', String(guildId)).eq('id', id).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Partnerships counted since `since` (a Date, or null for all time), newest first. `managerId` narrows it to one person. */
async function listLog(guildId, { since = null, managerId = null, limit = 5000 } = {}) {
  let query = database.from('partner_log').select('id,manager_id,partner_guild_id,partner_name,members,created_at').eq('guild_id', String(guildId));
  if (since) query = query.gte('created_at', since.toISOString());
  if (managerId) query = query.eq('manager_id', String(managerId));
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

module.exports = { DEFAULTS, getConfig, getConfigCached, upsertConfig, isBlacklisted, listBlacklist, addBlacklist, removeBlacklist, lastWith, addLog, removeLog, listLog };
