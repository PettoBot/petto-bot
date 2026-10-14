const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');

const cache = createExpiringCache(15_000, { name: 'scam-config', invalidateOn: ['scam_config'] });

const DEFAULTS = {
  enabled: false,
  action: 'alert',
  timeout_minutes: 120,
  delete_messages: true,
  delete_minutes: 15,
  channels_threshold: 3,
  window_seconds: 30,
  scan_text: true,
  scan_new_accounts: true,
  new_account_hours: 72,
  dm_user: true,
  alert_channel_id: null,
  ping_role_id: null,
  exempt_role_ids: [],
  exempt_channel_ids: [],
  caught: 0,
};

async function getConfig(guildId) {
  return cache.get(guildId, async () => {
    const { data, error } = await database.from('scam_config').select('*').eq('guild_id', guildId).maybeSingle();
    if (error) throw error;
    return { ...DEFAULTS, ...data, guild_id: guildId };
  });
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await database
    .from('scam_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  cache.delete(guildId);
  return { ...DEFAULTS, ...data };
}

async function addEvent(row) {
  const { data, error } = await database.from('scam_events').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function listEvents(guildId, limit = 10) {
  const { data, error } = await database.from('scam_events').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function countCaught(guildId, current) {
  // A missed count is not worth failing a detection for.
  await database.from('scam_config').update({ caught: (current ?? 0) + 1 }).eq('guild_id', guildId).then(() => cache.delete(guildId), () => {});
}

module.exports = { DEFAULTS, getConfig, upsertConfig, addEvent, listEvents, countCaught };
