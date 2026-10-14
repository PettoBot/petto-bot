const database = require('./database');

const DEFAULTS = { channel_ids: [], pause_invites: true, raise_verification: false, auto_end_minutes: 0, announce_channel_id: null, message: null };

async function getConfig(guildId) {
  const { data, error } = await database.from('lockdown_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, ...data, guild_id: guildId };
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await database.from('lockdown_config').upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return { ...DEFAULTS, ...data };
}

async function getActive(guildId) {
  const { data, error } = await database.from('lockdowns').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveActive(row) {
  const { error } = await database.from('lockdowns').upsert(row, { onConflict: 'guild_id' });
  if (error) throw error;
}

async function clearActive(guildId) {
  const { error } = await database.from('lockdowns').delete().eq('guild_id', guildId);
  if (error) throw error;
}

async function listDue(nowIso) {
  const { data, error } = await database.from('lockdowns').select('*').not('ends_at', 'is', null).lte('ends_at', nowIso);
  if (error) throw error;
  return data ?? [];
}

module.exports = { DEFAULTS, getConfig, upsertConfig, getActive, saveActive, clearActive, listDue };
