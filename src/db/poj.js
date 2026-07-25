const supabase = require('./supabase');

const MAX_CHANNELS = 10;

async function getConfig(guildId) {
  const { data, error } = await supabase.from('poj_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureConfig(guildId) {
  const existing = await getConfig(guildId);
  if (existing) return existing;
  const { data, error } = await supabase.from('poj_config').insert({ guild_id: guildId }).select('*').single();
  if (error) throw error;
  return data;
}

async function setEnabled(guildId, enabled) {
  const { data, error } = await supabase.from('poj_config').upsert({ guild_id: guildId, enabled }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function listChannels(guildId) {
  const { data, error } = await supabase.from('poj_channels').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function addChannel(guildId, channelId, deleteAfterMs) {
  const existing = await listChannels(guildId);
  if (existing.length >= MAX_CHANNELS && !existing.some((c) => c.channel_id === channelId)) {
    const err = new Error(`Maximum of ${MAX_CHANNELS} ping-on-join channels reached. Remove one first.`);
    err.userFacing = true;
    throw err;
  }

  const { data, error } = await supabase.from('poj_channels').upsert({ guild_id: guildId, channel_id: channelId, delete_after_ms: deleteAfterMs }, { onConflict: 'guild_id,channel_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function removeChannel(guildId, channelId) {
  const { data, error } = await supabase.from('poj_channels').delete().eq('guild_id', guildId).eq('channel_id', channelId).select('channel_id');
  if (error) throw error;
  return data.length > 0;
}

async function clearChannels(guildId) {
  const { error } = await supabase.from('poj_channels').delete().eq('guild_id', guildId);
  if (error) throw error;
}

module.exports = { MAX_CHANNELS, getConfig, ensureConfig, setEnabled, listChannels, addChannel, removeChannel, clearChannels };
