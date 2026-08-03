const supabase = require('./supabase');

async function add(row) {
  const { data, error } = await supabase.from('server_counters').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function list(guildId) {
  const { data, error } = await supabase.from('server_counters').select('*').eq('guild_id', guildId).order('id');
  if (error) throw error;
  return data ?? [];
}

async function listAll() {
  const { data, error } = await supabase.from('server_counters').select('*').order('guild_id').order('id');
  if (error) throw error;
  return data ?? [];
}

async function remove(guildId, channelId) {
  const { data, error } = await supabase.from('server_counters').delete().eq('guild_id', guildId).eq('channel_id', channelId).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = { add, list, listAll, remove };
