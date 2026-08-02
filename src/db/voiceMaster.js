const supabase = require('./supabase');

async function getConfig(guildId) {
  const { data, error } = await supabase.from('voice_configs').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, changes) {
  // PostgREST upsert can attempt an INSERT when only a partial patch is sent.
  // That breaks this table because creator_channel_id and panel_channel_id are
  // required. Update an existing guild row explicitly, and only insert complete
  // setup data for a new guild.
  const existing = await getConfig(guildId);
  const payload = { ...changes, updated_at: new Date().toISOString() };
  const query = existing
    ? supabase.from('voice_configs').update(payload).eq('guild_id', guildId)
    : supabase.from('voice_configs').insert({ guild_id: guildId, ...payload });
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return data;
}

async function removeConfig(guildId) {
  const { error } = await supabase.from('voice_configs').delete().eq('guild_id', guildId);
  if (error) throw error;
}

async function getTemp(channelId) {
  const { data, error } = await supabase.from('voice_temp_channels').select('*').eq('channel_id', channelId).maybeSingle();
  if (error) throw error;
  return data;
}

async function createTemp(values) {
  const { data, error } = await supabase.from('voice_temp_channels').insert(values).select('*').single();
  if (error) throw error;
  return data;
}

async function updateTemp(channelId, changes) {
  const { data, error } = await supabase.from('voice_temp_channels').update(changes).eq('channel_id', channelId).select('*').single();
  if (error) throw error;
  return data;
}

async function removeTemp(channelId) {
  const { error } = await supabase.from('voice_temp_channels').delete().eq('channel_id', channelId);
  if (error) throw error;
}

async function countTemps(guildId) {
  const { count, error } = await supabase.from('voice_temp_channels').select('channel_id', { count: 'exact', head: true }).eq('guild_id', guildId);
  if (error) throw error;
  return count ?? 0;
}

module.exports = { getConfig, upsertConfig, removeConfig, getTemp, createTemp, updateTemp, removeTemp, countTemps };
