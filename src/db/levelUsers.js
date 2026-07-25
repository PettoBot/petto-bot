const supabase = require('./supabase');

async function getUser(guildId, userId) {
  const { data, error } = await supabase.from('level_users').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureUser(guildId, userId) {
  const existing = await getUser(guildId, userId);
  if (existing) return existing;
  const { data, error } = await supabase.from('level_users').insert({ guild_id: guildId, user_id: userId }).select('*').single();
  if (error) throw error;
  return data;
}

/** Atomically adds xp/messages/vc_minutes (upserting the row if it doesn't exist yet) via the add_level_xp() RPC. */
async function addXp(guildId, userId, { xpGain = 0, messageInc = 0, vcInc = 0 }) {
  const { data, error } = await supabase.rpc('add_level_xp', { p_guild_id: guildId, p_user_id: userId, p_xp_gain: xpGain, p_message_inc: messageInc, p_vc_inc: vcInc });
  if (error) throw error;
  return data;
}

async function setLevel(guildId, userId, level) {
  const { data, error } = await supabase.from('level_users').update({ level, updated_at: new Date().toISOString() }).eq('guild_id', guildId).eq('user_id', userId).select('*').single();
  if (error) throw error;
  return data;
}

async function setXpAndLevel(guildId, userId, xp, level) {
  const { data, error } = await supabase
    .from('level_users')
    .upsert({ guild_id: guildId, user_id: userId, xp, level, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function resetUser(guildId, userId) {
  const { error } = await supabase.from('level_users').upsert({ guild_id: guildId, user_id: userId, xp: 0, level: 0, messages: 0, vc_minutes: 0, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
}

/** 1-based rank position by XP (ties broken by whoever reached that XP first is not tracked — same ordering as bli). */
async function getRank(guildId, xp) {
  const { count, error } = await supabase.from('level_users').select('user_id', { count: 'exact', head: true }).eq('guild_id', guildId).gt('xp', xp);
  if (error) throw error;
  return (count ?? 0) + 1;
}

async function countRanked(guildId) {
  const { count, error } = await supabase.from('level_users').select('user_id', { count: 'exact', head: true }).eq('guild_id', guildId).gt('xp', 0);
  if (error) throw error;
  return count ?? 0;
}

async function getLeaderboardPage(guildId, { offset, limit }) {
  const { data, error } = await supabase.from('level_users').select('*').eq('guild_id', guildId).gt('xp', 0).order('xp', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw error;
  return data;
}

module.exports = { getUser, ensureUser, addXp, setLevel, setXpAndLevel, resetUser, getRank, countRanked, getLeaderboardPage };
