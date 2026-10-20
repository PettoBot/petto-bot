const database = require('./database');
const images = require('./profileHistoryImages');

const KINDS = ['avatar', 'name', 'nickname'];
const KEEP_PER_KIND = 200; // the newest this many of each kind (and of each server, for nicknames) are kept

/** The newest value saved for a person (and server), or null. */
async function latest(userId, kind, guildId = null) {
  let query = database.from('identity_history').select('value').eq('user_id', userId).eq('kind', kind);
  query = guildId ? query.eq('guild_id', guildId) : query.is('guild_id', null);
  const { data, error } = await query.order('seen_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.value ?? null;
}

async function add(userId, kind, value, guildId = null) {
  const { error } = await database.from('identity_history').insert({ user_id: userId, guild_id: guildId, kind, value });
  if (error) throw error;
}

/** Old rows beyond the newest KEEP_PER_KIND of a kind are removed. */
async function trim(userId, kind, guildId = null) {
  let query = database.from('identity_history').select('id').eq('user_id', userId).eq('kind', kind);
  query = guildId ? query.eq('guild_id', guildId) : query.is('guild_id', null);
  const { data, error } = await query.order('seen_at', { ascending: false }).range(KEEP_PER_KIND, KEEP_PER_KIND + 99);
  if (error) throw error;
  if (!data?.length) return;
  const { error: deleteError } = await database.from('identity_history').delete().in('id', data.map((row) => row.id));
  if (deleteError) throw deleteError;
}

/** The saved values of a kind, newest first. Nicknames can be limited to one server. */
async function list(userId, kind, { guildId = null, limit = KEEP_PER_KIND } = {}) {
  let query = database.from('identity_history').select('value,guild_id,seen_at').eq('user_id', userId).eq('kind', kind);
  if (guildId) query = query.eq('guild_id', guildId);
  const { data, error } = await query.order('seen_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function count(userId, kind) {
  const { count: total, error } = await database.from('identity_history').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', kind);
  if (error) throw error;
  return total ?? 0;
}

/** Deletes what is saved of one kind (or all of them) for a person. Returns how many rows went. */
async function clear(userId, kind = null) {
  let query = database.from('identity_history').delete().eq('user_id', userId);
  if (kind) query = query.eq('kind', kind);
  const { data, error } = await query.select('id');
  if (error) throw error;
  // The copies of the avatars go too (a trigger of schema.sql does the same for the dashboard's deletes).
  if (!kind || kind === 'avatar') await images.clearUser(userId);
  return (data ?? []).length;
}

async function isOptedOut(userId) {
  const { data, error } = await database.from('identity_history_optout').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function setOptOut(userId, optedOut) {
  if (optedOut) {
    const { error } = await database.from('identity_history_optout').upsert({ user_id: userId }, { onConflict: 'user_id' });
    if (error) throw error;
    await images.clearUser(userId); // the copies of the avatars are not kept for someone who turned it off (a trigger does it as well)
  } else {
    const { error } = await database.from('identity_history_optout').delete().eq('user_id', userId);
    if (error) throw error;
  }
}

module.exports = { KINDS, KEEP_PER_KIND, latest, add, trim, list, count, clear, isOptedOut, setOptOut };
