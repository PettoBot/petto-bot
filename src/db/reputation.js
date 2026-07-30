const supabase = require('./supabase');

const DEFAULT_CONFIG = { enabled: true, cooldown_hours: 24 };

async function getConfig(guildId) {
  const { data, error } = await supabase.from('reputation_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_CONFIG, ...data, guild_id: guildId };
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await supabase.from('reputation_config').upsert({ guild_id: guildId, ...patch }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function getUser(guildId, userId) {
  const { data, error } = await supabase.from('reputation').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ?? { guild_id: guildId, user_id: userId, points: 0, last_given_at: null };
}

/** Bumps the receiver's points and stamps the giver's own last_given_at (their cooldown), in one round trip each. */
async function giveRep(guildId, giverId, receiverId) {
  const receiver = await getUser(guildId, receiverId);
  const { error: e1 } = await supabase
    .from('reputation')
    .upsert({ guild_id: guildId, user_id: receiverId, points: receiver.points + 1 }, { onConflict: 'guild_id,user_id' });
  if (e1) throw e1;

  const giver = await getUser(guildId, giverId);
  const { error: e2 } = await supabase
    .from('reputation')
    .upsert({ guild_id: guildId, user_id: giverId, points: giver.points, last_given_at: new Date().toISOString() }, { onConflict: 'guild_id,user_id' });
  if (e2) throw e2;
}

async function getLeaderboard(guildId, limit = 10) {
  const { data, error } = await supabase.from('reputation').select('*').eq('guild_id', guildId).order('points', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

async function resetUser(guildId, userId) {
  const { error } = await supabase.from('reputation').upsert({ guild_id: guildId, user_id: userId, points: 0 }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
}

module.exports = { getConfig, upsertConfig, getUser, giveRep, getLeaderboard, resetUser };
