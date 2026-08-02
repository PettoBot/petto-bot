const supabase = require('./supabase');
const CACHE_TTL_MS = 15_000;
const listCache = new Map();

async function listThreads(guildId) {
  const { data, error } = await supabase.from('auto_threads').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function listThreadsCached(guildId) {
  const cached = listCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const rows = await listThreads(guildId);
  listCache.set(guildId, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

function invalidateGuildCache(guildId) {
  listCache.delete(guildId);
}

async function getThread(guildId, channelId) {
  const rows = await listThreadsCached(guildId);
  return rows.find((row) => row.channel_id === channelId) ?? null;
}

async function upsertThread(guildId, channelId, patch) {
  const { data, error } = await supabase
    .from('auto_threads')
    .upsert({ guild_id: guildId, channel_id: channelId, ...patch }, { onConflict: 'guild_id,channel_id' })
    .select('*')
    .single();
  if (error) throw error;
  invalidateGuildCache(guildId);
  return data;
}

async function removeThread(guildId, channelId) {
  const { data, error } = await supabase.from('auto_threads').delete().eq('guild_id', guildId).eq('channel_id', channelId).select('channel_id');
  if (error) throw error;
  invalidateGuildCache(guildId);
  return data.length > 0;
}

module.exports = { listThreads, listThreadsCached, getThread, upsertThread, removeThread, invalidateGuildCache };
