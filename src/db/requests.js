const database = require('./database');

const DEFAULTS = { enabled: false, channel_id: null, staff_role_id: null, ping_role_id: null, max_open: 3, completion_hours: 0, messages: {} };

async function getConfig(guildId) {
  const { data, error } = await database.from('request_config').select('*').eq('guild_id', String(guildId)).maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULTS, ...data } : null;
}

async function upsertConfig(guildId, changes) {
  const { data, error } = await database.from('request_config').upsert({ guild_id: String(guildId), ...changes, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return { ...DEFAULTS, ...data };
}

/** Servers that give a claimed request a time to be finished. */
async function listConfigsWithTimeout() {
  const { data, error } = await database.from('request_config').select('*').eq('enabled', true).gt('completion_hours', 0);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...DEFAULTS, ...row }));
}

/** Makes a request with the next number of the server. A second try covers two requests made at the same moment. */
async function create({ guildId, userId, content }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: last, error: lastError } = await database.from('requests').select('number').eq('guild_id', String(guildId)).order('number', { ascending: false }).limit(1);
    if (lastError) throw lastError;
    const number = (last?.[0]?.number ?? 0) + 1;
    const { data, error } = await database.from('requests').insert({ guild_id: String(guildId), number, user_id: String(userId), content }).select('*').single();
    if (!error) return data;
    if (error.code !== '23505') throw error;
  }
  throw new Error('Could not number the request.');
}

async function get(guildId, number) {
  const { data, error } = await database.from('requests').select('*').eq('guild_id', String(guildId)).eq('number', number).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function update(guildId, number, changes) {
  const { data, error } = await database.from('requests').update(changes).eq('guild_id', String(guildId)).eq('number', number).select('*').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** The requests of a server, newest first. `statuses` narrows them, `userId` shows one member's. */
async function list(guildId, { statuses = ['open', 'claimed'], userId = null, limit = 25 } = {}) {
  let query = database.from('requests').select('*').eq('guild_id', String(guildId)).in('status', statuses);
  if (userId) query = query.eq('user_id', String(userId));
  const { data, error } = await query.order('number', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function countOpenBy(guildId, userId) {
  const { count, error } = await database.from('requests').select('id', { count: 'exact', head: true }).eq('guild_id', String(guildId)).eq('user_id', String(userId)).in('status', ['open', 'claimed']);
  if (error) throw error;
  return count ?? 0;
}

/** Claimed requests of a server that were claimed before `before`. */
async function listClaimedBefore(guildId, before) {
  const { data, error } = await database.from('requests').select('*').eq('guild_id', String(guildId)).eq('status', 'claimed').lt('claimed_at', before.toISOString()).limit(50);
  if (error) throw error;
  return data ?? [];
}

module.exports = { DEFAULTS, getConfig, upsertConfig, listConfigsWithTimeout, create, get, update, list, countOpenBy, listClaimedBefore };
