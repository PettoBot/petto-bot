// The name and the picture a server chose for the messages Petto sends in some places (quest alerts, welcome, leave, boost,
// sanctions). The message goes out through a webhook of the channel that Petto makes by itself, so it can have its own look.
const database = require('./database');

const FEATURES = ['quests', 'welcome', 'leave', 'boost', 'sanctions'];
const CACHE_MS = 60_000;
const cache = new Map();

async function list(guildId) {
  const key = String(guildId);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rows;
  const { data, error } = await database.from('sender_identities').select('*').eq('guild_id', key);
  if (error) throw error;
  const rows = data ?? [];
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

async function get(guildId, feature) {
  const rows = await list(guildId);
  return rows.find((row) => row.feature === feature) ?? null;
}

async function upsert(guildId, feature, { name = null, avatarUrl = null }) {
  const { error } = await database.from('sender_identities').upsert({ guild_id: String(guildId), feature, name, avatar_url: avatarUrl, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,feature' });
  if (error) throw error;
  cache.delete(String(guildId));
}

async function remove(guildId, feature) {
  const { error } = await database.from('sender_identities').delete().eq('guild_id', String(guildId)).eq('feature', feature);
  if (error) throw error;
  cache.delete(String(guildId));
}

function clearCache(guildId) { if (guildId) cache.delete(String(guildId)); else cache.clear(); }

module.exports = { FEATURES, list, get, upsert, remove, clearCache };
