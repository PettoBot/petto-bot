const database = require('./database');
const { getPrimaryPool } = require('./postgres');

async function getUser(guildId, userId) {
  const { data, error } = await database.from('level_users').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** The rows of some members of a server, as a Map by user id (members with no row are not in it). */
async function getUsers(guildId, userIds) {
  const rows = new Map();
  const ids = [...new Set(userIds)];
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await database.from('level_users').select('user_id,xp,level,voice_xp,voice_level').eq('guild_id', guildId).in('user_id', ids.slice(start, start + 200));
    if (error) throw error;
    for (const row of data ?? []) rows.set(row.user_id, row);
  }
  return rows;
}

async function ensureUser(guildId, userId) {
  const existing = await getUser(guildId, userId);
  if (existing) return existing;
  const { data, error } = await database.from('level_users').insert({ guild_id: guildId, user_id: userId }).select('*').single();
  if (error) throw error;
  return data;
}

/** Atomically adds xp/messages/vc_minutes (upserting the row if it doesn't exist yet) via the add_level_xp() RPC. */
async function addXp(guildId, userId, { xpGain = 0, messageInc = 0, vcInc = 0 }) {
  const { data, error } = await database.rpc('add_level_xp', { p_guild_id: guildId, p_user_id: userId, p_xp_gain: xpGain, p_message_inc: messageInc, p_vc_inc: vcInc });
  if (error) throw error;
  return data;
}

async function addVoiceXp(guildId, userId, { xpGain = 0, vcInc = 0 }) {
  const { data, error } = await database.rpc('add_voice_xp', { p_guild_id: guildId, p_user_id: userId, p_voice_xp_gain: xpGain, p_vc_inc: vcInc });
  if (error) throw error;
  return data;
}

async function setLevel(guildId, userId, level) {
  const { data, error } = await database.from('level_users').update({ level, updated_at: new Date().toISOString() }).eq('guild_id', guildId).eq('user_id', userId).select('*').single();
  if (error) throw error;
  return data;
}

async function setXpAndLevel(guildId, userId, xp, level) {
  const { data, error } = await database
    .from('level_users')
    .upsert({ guild_id: guildId, user_id: userId, xp, level, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function resetUser(guildId, userId) {
  const { error } = await database.from('level_users').upsert({ guild_id: guildId, user_id: userId, xp: 0, level: 0, voice_xp: 0, voice_level: 0, messages: 0, vc_minutes: 0, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
}

/** A page of the members of a server who have a level (messages or voice), by user id, for the ones who need their reward roles checked. */
async function listWithLevels(guildId, { offset = 0, limit = 100 } = {}) {
  const { data, error } = await database.from('level_users').select('user_id,level,voice_level').eq('guild_id', guildId).or('level.gt.0,voice_level.gt.0').order('user_id', { ascending: true }).range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/** 1-based rank position by XP (ties broken by whoever reached that XP first is not tracked — same ordering as bli). */
async function getRank(guildId, xp) {
  const { count, error } = await database.from('level_users').select('user_id', { count: 'exact', head: true }).eq('guild_id', guildId).gt('xp', xp);
  if (error) throw error;
  return (count ?? 0) + 1;
}

async function countRanked(guildId) {
  const { count, error } = await database.from('level_users').select('user_id', { count: 'exact', head: true }).eq('guild_id', guildId).gt('xp', 0);
  if (error) throw error;
  return count ?? 0;
}

async function getLeaderboardPage(guildId, { offset, limit }) {
  const { data, error } = await database.from('level_users').select('*').eq('guild_id', guildId).gt('xp', 0).order('xp', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw error;
  return data;
}

async function getVoiceRank(guildId, voiceXp) {
  const { count, error } = await database.from('level_users').select('user_id', { count: 'exact', head: true }).eq('guild_id', guildId).gt('voice_xp', voiceXp);
  if (error) throw error;
  return (count ?? 0) + 1;
}

async function countVoiceRanked(guildId) {
  const { count, error } = await database.from('level_users').select('user_id', { count: 'exact', head: true }).eq('guild_id', guildId).gt('voice_xp', 0);
  if (error) throw error;
  return count ?? 0;
}

async function getVoiceLeaderboardPage(guildId, { offset, limit }) {
  const { data, error } = await database.from('level_users').select('*').eq('guild_id', guildId).gt('voice_xp', 0).order('voice_xp', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw error;
  return data;
}

async function setVoiceLevel(guildId, userId, level) {
  const { data, error } = await database.from('level_users').update({ voice_level: level, updated_at: new Date().toISOString() }).eq('guild_id', guildId).eq('user_id', userId).select('*').single();
  if (error) throw error;
  return data;
}

/** Marks a member active on `day` (a `YYYY-MM-DD` string). Says whether it is their first activity that day and the streak now. */
async function touchStreak(guildId, userId, day) {
  const { rows } = await getPrimaryPool().query('select new_day, streak from touch_level_streak($1, $2, $3::date)', [String(guildId), String(userId), day]);
  return { newDay: Boolean(rows[0]?.new_day), streak: Number(rows[0]?.streak ?? 0) };
}

module.exports = { touchStreak, getUser, getUsers, listWithLevels, ensureUser, addXp, addVoiceXp, setLevel, setVoiceLevel, setXpAndLevel, resetUser, getRank, countRanked, getLeaderboardPage, getVoiceRank, countVoiceRanked, getVoiceLeaderboardPage };
