const supabase = require('./supabase');

/** Finds a matching rule: a server-wide (channel_id null) rule, or one for `channelId` specifically. `channelId` may be omitted (checks only for a server-wide rule). */
async function find(guildId, command, channelId) {
  const filter = channelId ? `channel_id.is.null,channel_id.eq.${channelId}` : 'channel_id.is.null';
  const { data, error } = await supabase.from('disabled_commands').select('*').eq('guild_id', guildId).eq('command', command).or(filter);
  if (error) throw error;
  return data[0] ?? null;
}

async function listForGuild(guildId) {
  const { data, error } = await supabase.from('disabled_commands').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function disable(guildId, command, channelId) {
  const { data, error } = await supabase.from('disabled_commands').insert({ guild_id: guildId, command, channel_id: channelId ?? null }).select('*').single();
  if (error) throw error;
  invalidateCache(guildId);
  return data;
}

async function enable(guildId, command, channelId) {
  let query = supabase.from('disabled_commands').delete().eq('guild_id', guildId).eq('command', command);
  query = channelId ? query.eq('channel_id', channelId) : query.is('channel_id', null);
  const { data, error } = await query.select('id');
  if (error) throw error;
  invalidateCache(guildId);
  return data.length > 0;
}

// Every prefix command message checked `find()` uncached, a real Supabase round trip on
// every single message even though almost no guild has any disabled-command rules and they
// change rarely. Cached the same way getPrefix() already caches guilds.prefix.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // guildId -> { rows, expiresAt }

async function listForGuildCached(guildId) {
  const hit = cache.get(guildId);
  if (hit && hit.expiresAt > Date.now()) return hit.rows;
  const rows = await listForGuild(guildId);
  cache.set(guildId, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

function invalidateCache(guildId) {
  cache.delete(guildId);
}

/** Same result as `find()`, backed by the guild's cached rule list instead of a fresh query every call. */
async function findCached(guildId, command, channelId) {
  const rows = await listForGuildCached(guildId);
  return rows.find((r) => r.command === command && (r.channel_id === null || r.channel_id === channelId)) ?? null;
}

module.exports = { find, listForGuild, disable, enable, findCached, invalidateCache };
