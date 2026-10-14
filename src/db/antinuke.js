const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');

const configCache = createExpiringCache(15_000, { name: 'antinuke-config', invalidateOn: ['antinuke_config'] });
const rulesCache = createExpiringCache(15_000, { name: 'antinuke-rules', invalidateOn: ['antinuke_rules'] });

async function getConfig(guildId) {
  return configCache.get(guildId, async () => {
    const { data, error } = await database.from('antinuke_config').select('*').eq('guild_id', guildId).maybeSingle();
    if (error) throw error;
    return data;
  });
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await database
    .from('antinuke_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  configCache.delete(guildId);
  return data;
}

async function addWhitelist(guildId, id) {
  const config = (await getConfig(guildId)) ?? { whitelist_ids: [] };
  const ids = new Set(config.whitelist_ids ?? []);
  ids.add(id);
  return upsertConfig(guildId, { whitelist_ids: [...ids] });
}

async function removeWhitelist(guildId, id) {
  const config = (await getConfig(guildId)) ?? { whitelist_ids: [] };
  const ids = (config.whitelist_ids ?? []).filter((x) => x !== id);
  return upsertConfig(guildId, { whitelist_ids: ids });
}

async function addWhitelistRole(guildId, id) {
  const config = (await getConfig(guildId)) ?? { whitelist_role_ids: [] };
  const ids = new Set(config.whitelist_role_ids ?? []);
  ids.add(id);
  return upsertConfig(guildId, { whitelist_role_ids: [...ids] });
}

async function removeWhitelistRole(guildId, id) {
  const config = (await getConfig(guildId)) ?? { whitelist_role_ids: [] };
  const ids = (config.whitelist_role_ids ?? []).filter((x) => x !== id);
  return upsertConfig(guildId, { whitelist_role_ids: ids });
}

async function getRules(guildId) {
  return rulesCache.get(guildId, async () => {
    const { data, error } = await database.from('antinuke_rules').select('*').eq('guild_id', guildId);
    if (error) throw error;
    return data ?? [];
  });
}

async function upsertRule(guildId, rule, patch) {
  const { data, error } = await database
    .from('antinuke_rules')
    .upsert({ guild_id: guildId, rule, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,rule' })
    .select('*')
    .single();
  if (error) throw error;
  rulesCache.delete(guildId);
  return data;
}

async function createEvent(row) {
  const { data, error } = await database.from('antinuke_events').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function getEvent(guildId, id) {
  const { data, error } = await database.from('antinuke_events').select('*').eq('guild_id', guildId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function listEvents(guildId, limit = 10) {
  const { data, error } = await database.from('antinuke_events').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function markRestored(guildId, id) {
  const { error } = await database.from('antinuke_events').update({ restored_at: new Date().toISOString() }).eq('guild_id', guildId).eq('id', id);
  if (error) throw error;
}

module.exports = { getConfig, upsertConfig, addWhitelist, removeWhitelist, addWhitelistRole, removeWhitelistRole, getRules, upsertRule, createEvent, getEvent, listEvents, markRestored };
