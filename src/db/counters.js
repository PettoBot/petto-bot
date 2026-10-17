const database = require('./database');

async function add(row) {
  const { data, error } = await database.from('server_counters').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function list(guildId) {
  const { data, error } = await database.from('server_counters').select('*').eq('guild_id', guildId).order('id');
  if (error) throw error;
  return data ?? [];
}

async function listAll() {
  const { data, error } = await database.from('server_counters').select('*').order('guild_id').order('id');
  if (error) throw error;
  return data ?? [];
}

async function get(guildId, channelId) {
  const { data, error } = await database.from('server_counters').select('*').eq('guild_id', guildId).eq('channel_id', channelId).maybeSingle();
  if (error) throw error;
  return data;
}

async function update(guildId, channelId, patch) {
  const { data, error } = await database.from('server_counters').update(patch).eq('guild_id', guildId).eq('channel_id', channelId).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

async function remove(guildId, channelId) {
  const { data, error } = await database.from('server_counters').delete().eq('guild_id', guildId).eq('channel_id', channelId).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

// Milestone announcements: one row of settings per server (see counter_announce_config in schema.sql).
const ANNOUNCE_TABLE = 'counter_announce_config';

async function getAnnounce(guildId) {
  const { data, error } = await database.from(ANNOUNCE_TABLE).select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function listAnnounce() {
  const { data, error } = await database.from(ANNOUNCE_TABLE).select('*').eq('enabled', true);
  if (error) throw error;
  return data ?? [];
}

async function saveAnnounce(guildId, patch) {
  const write = () => database.from(ANNOUNCE_TABLE).upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' }).select('*').single();
  let { data, error } = await write();
  // A server with no row of its own yet (the settings point to guilds).
  if (error?.code === '23503') {
    await require('./guilds').ensureGuild(guildId);
    ({ data, error } = await write());
  }
  if (error) throw error;
  return data;
}

/** Notes the member number just announced (saved before the message goes out, so a crash can never send it twice). */
async function markAnnounced(guildId, number) {
  const { data, error } = await database.from(ANNOUNCE_TABLE).update({ last_announced: number }).eq('guild_id', guildId).select('last_announced');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = { add, get, update, list, listAll, remove, getAnnounce, listAnnounce, saveAnnounce, markAnnounced };
