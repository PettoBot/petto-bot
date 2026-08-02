const supabase = require('./supabase');

async function listThreads(guildId) {
  const { data, error } = await supabase.from('auto_threads').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function getThread(guildId, channelId) {
  const { data, error } = await supabase.from('auto_threads').select('*').eq('guild_id', guildId).eq('channel_id', channelId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertThread(guildId, channelId, patch) {
  const { data, error } = await supabase
    .from('auto_threads')
    .upsert({ guild_id: guildId, channel_id: channelId, ...patch }, { onConflict: 'guild_id,channel_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function removeThread(guildId, channelId) {
  const { data, error } = await supabase.from('auto_threads').delete().eq('guild_id', guildId).eq('channel_id', channelId).select('channel_id');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { listThreads, getThread, upsertThread, removeThread };
