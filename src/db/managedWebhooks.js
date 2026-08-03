const supabase = require('./supabase');

async function add(row) {
  const { data, error } = await supabase.from('managed_webhooks').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function update(guildId, localId, patch) {
  const { data, error } = await supabase.from('managed_webhooks').update(patch).eq('guild_id', guildId).eq('id', localId).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function list(guildId) {
  const { data, error } = await supabase.from('managed_webhooks').select('id,guild_id,channel_id,webhook_id,name,created_by,created_at').eq('guild_id', guildId).order('id');
  if (error) throw error;
  return data ?? [];
}

async function listWithTokens(guildId) {
  const { data, error } = await supabase.from('managed_webhooks').select('*').eq('guild_id', guildId).order('id');
  if (error) throw error;
  return data ?? [];
}

async function get(guildId, identifier) {
  const value = String(identifier ?? '').trim();
  const numeric = /^\d+$/.test(value) ? Number(value) : null;
  let query = supabase.from('managed_webhooks').select('*').eq('guild_id', guildId);
  query = numeric != null ? query.or(`id.eq.${numeric},webhook_id.eq.${value}`) : query.eq('webhook_id', value);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function getByChannel(guildId, channelId) {
  const { data, error } = await supabase.from('managed_webhooks').select('*').eq('guild_id', guildId).eq('channel_id', channelId).order('id');
  if (error) throw error;
  return data ?? [];
}

async function remove(guildId, webhookId) {
  const { data, error } = await supabase.from('managed_webhooks').delete().eq('guild_id', guildId).eq('webhook_id', webhookId).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = { add, update, list, listWithTokens, get, getByChannel, remove };
