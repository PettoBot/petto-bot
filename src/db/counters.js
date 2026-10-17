const database = require('./database');

async function add(row) {
  const { data, error } = await database.from('server_counters').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

/** The order of the dashboard list: the position given by dragging, then the oldest first. */
function byPosition(a, b) {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER;
  const pb = b.position ?? Number.MAX_SAFE_INTEGER;
  return pa - pb || Number(a.id) - Number(b.id);
}

async function list(guildId) {
  const { data, error } = await database.from('server_counters').select('*').eq('guild_id', guildId).order('id');
  if (error) throw error;
  return (data ?? []).sort(byPosition);
}

async function listAll() {
  const { data, error } = await database.from('server_counters').select('*').order('guild_id').order('id');
  if (error) throw error;
  return (data ?? []).sort((a, b) => String(a.guild_id).localeCompare(String(b.guild_id)) || byPosition(a, b));
}

/** Saves the order of the counters of a server (the channel ids, first to last). */
async function setOrder(guildId, channelIds) {
  for (const [index, channelId] of channelIds.entries()) {
    const { error } = await database.from('server_counters').update({ position: index }).eq('guild_id', guildId).eq('channel_id', channelId);
    if (error) throw error;
  }
}

/**
 * The member count of every server of the bot for a day, in one statement (`rows`: [{ guildId, members }]). Raw SQL on the main pool:
 * it is not a setting, so it does not tell the dashboard that the servers changed.
 */
async function saveMemberDays(day, rows) {
  if (!rows.length) return 0;
  const { getPrimaryPool } = require('./postgres');
  const pool = getPrimaryPool();
  let saved = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await pool.query(
      `insert into guild_member_days (guild_id, day, members)
       select g, $1::date, m from unnest($2::text[], $3::int[]) as t(g, m)
       on conflict (guild_id, day) do update set members = excluded.members`,
      [day, chunk.map((row) => String(row.guildId)), chunk.map((row) => Math.max(0, Math.trunc(Number(row.members) || 0)))],
    );
    saved += chunk.length;
  }
  return saved;
}

async function pruneMemberDays(beforeDay) {
  const { getPrimaryPool } = require('./postgres');
  await getPrimaryPool().query('delete from guild_member_days where day < $1::date', [beforeDay]);
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

module.exports = { add, get, update, list, listAll, remove, setOrder, saveMemberDays, pruneMemberDays, byPosition, getAnnounce, listAnnounce, saveAnnounce, markAnnounced };
