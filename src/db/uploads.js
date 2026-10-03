const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');

// Every message of a server passes through the upload check, so the settings are kept for a few seconds.
const configCache = createExpiringCache(15_000);
const DEFAULTS = { enabled: false, channel_ids: [], uploader_role_id: null, welcome: {} };

async function getConfig(guildId) {
  const { data, error } = await database.from('upload_config').select('*').eq('guild_id', String(guildId)).maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULTS, ...data } : null;
}

function getConfigCached(guildId) {
  return configCache.get(guildId, () => getConfig(guildId), { staleIfError: true });
}

async function upsertConfig(guildId, changes) {
  const { data, error } = await database
    .from('upload_config')
    .upsert({ guild_id: String(guildId), ...changes, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  configCache.delete(String(guildId));
  return { ...DEFAULTS, ...data };
}

/** Whether the member has an upload counted already. */
async function hasUploaded(guildId, userId) {
  const { data, error } = await database.from('upload_log').select('id').eq('guild_id', String(guildId)).eq('user_id', String(userId)).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function addLog({ guildId, userId, channelId, messageId, files }) {
  const { data, error } = await database
    .from('upload_log')
    .insert({ guild_id: String(guildId), user_id: String(userId), channel_id: String(channelId), message_id: String(messageId), files })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function listLog(guildId, { since = null, userId = null, limit = 5000 } = {}) {
  let query = database.from('upload_log').select('id,user_id,channel_id,files,created_at').eq('guild_id', String(guildId));
  if (since) query = query.gte('created_at', since.toISOString());
  if (userId) query = query.eq('user_id', String(userId));
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

module.exports = { DEFAULTS, getConfig, getConfigCached, upsertConfig, hasUploaded, addLog, listLog };
