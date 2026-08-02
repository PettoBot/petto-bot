const supabase = require('./supabase');

async function get(guildId, id) {
  const { data, error } = await supabase.from('auto_messages').select('*').eq('guild_id', guildId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function list(guildId) {
  const { data, error } = await supabase.from('auto_messages').select('*').eq('guild_id', guildId).order('channel_id');
  if (error) throw error;
  return data;
}

async function listDue() {
  const { data, error } = await supabase.from('auto_messages').select('*').lte('next_run_at', new Date().toISOString()).order('next_run_at').limit(100);
  if (error) throw error;
  return data;
}

async function add({ guildId, channelId, intervalMs, message }) {
  const { data, error } = await supabase.from('auto_messages').insert({ guild_id: guildId, channel_id: channelId, interval_ms: intervalMs, message, next_run_at: new Date(Date.now() + intervalMs).toISOString() }).select('*').single();
  if (error) throw error;
  return data;
}

async function remove(guildId, id) {
  const { data, error } = await supabase.from('auto_messages').delete().eq('guild_id', guildId).eq('id', id).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function scheduleNext(id, _expectedRunAt, intervalMs) {
  const next = new Date(Date.now() + intervalMs).toISOString();
  const { error } = await supabase.from('auto_messages').update({ next_run_at: next }).eq('id', id);
  if (error) throw error;
}

module.exports = { get, list, listDue, add, remove, scheduleNext };
