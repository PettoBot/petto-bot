const database = require('./database');
const { ensureGuild } = require('./guilds');

const MAX_REPLIES = 50;
const NAME = /^[a-z0-9][a-z0-9_-]{0,29}$/;

const normalizeName = (name) => String(name ?? '').trim().toLowerCase();

async function list(guildId) {
  const { data, error } = await database.from('ticket_replies').select('*').eq('guild_id', guildId).order('name', { ascending: true }).limit(MAX_REPLIES + 5);
  if (error) throw error;
  return data ?? [];
}

async function get(guildId, name) {
  const { data, error } = await database.from('ticket_replies').select('*').eq('guild_id', guildId).eq('name', normalizeName(name)).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsert(guildId, name, content, userId) {
  await ensureGuild(guildId);
  const { data, error } = await database
    .from('ticket_replies')
    .upsert({ guild_id: guildId, name: normalizeName(name), content: String(content).slice(0, 1500), created_by: userId ?? null, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,name' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function remove(guildId, name) {
  const { data, error } = await database.from('ticket_replies').delete().eq('guild_id', guildId).eq('name', normalizeName(name)).select('name');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = { MAX_REPLIES, NAME, normalizeName, list, get, upsert, remove };
