const database = require('./database');

const DEFAULT_CONFIG = { enabled: true, cooldown_hours: 24, giver_role_ids: [], blocked_role_ids: [], channel_ids: [], rewards: [] };

async function getConfig(guildId) {
  const { data, error } = await database.from('reputation_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_CONFIG, ...data, guild_id: guildId };
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await database.from('reputation_config').upsert({ guild_id: guildId, ...patch }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function getUser(guildId, userId) {
  const { data, error } = await database.from('reputation').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ?? { guild_id: guildId, user_id: userId, points: 0, last_given_at: null };
}

/** Bumps the receiver's points and stamps the giver's own last_given_at (their cooldown), in one round trip each. */
async function giveRep(guildId, giverId, receiverId) {
  const receiver = await getUser(guildId, receiverId);
  const { error: e1 } = await database
    .from('reputation')
    .upsert({ guild_id: guildId, user_id: receiverId, points: receiver.points + 1 }, { onConflict: 'guild_id,user_id' });
  if (e1) throw e1;

  const giver = await getUser(guildId, giverId);
  const { error: e2 } = await database
    .from('reputation')
    .upsert({ guild_id: guildId, user_id: giverId, points: giver.points, last_given_at: new Date().toISOString() }, { onConflict: 'guild_id,user_id' });
  if (e2) throw e2;
}

const LOG_DAYS = 90;

/** One line in the log of points given; rows older than 90 days go at the same time. Failures never stop the point itself. */
async function logRep(guildId, giverId, receiverId, channelId) {
  const { error } = await database.from('reputation_log').insert({ guild_id: guildId, giver_id: giverId, receiver_id: receiverId, channel_id: channelId ?? null });
  if (error) throw error;
  await database.from('reputation_log').delete().eq('guild_id', guildId).lt('created_at', new Date(Date.now() - LOG_DAYS * 86400_000).toISOString());
}

/** The reward roles a number of points has reached, from the saved list (bad entries are skipped). */
function rewardsFor(config, points) {
  const list = Array.isArray(config?.rewards) ? config.rewards : [];
  return list
    .map((reward) => ({ points: Number(reward?.points), roleId: String(reward?.role_id ?? '') }))
    .filter((reward) => Number.isInteger(reward.points) && reward.points > 0 && /^\d{15,25}$/.test(reward.roleId) && points >= reward.points);
}

async function getLeaderboard(guildId, limit = 10) {
  const { data, error } = await database.from('reputation').select('*').eq('guild_id', guildId).order('points', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

async function resetUser(guildId, userId) {
  const { error } = await database.from('reputation').upsert({ guild_id: guildId, user_id: userId, points: 0 }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
}

module.exports = { getConfig, upsertConfig, getUser, giveRep, logRep, rewardsFor, getLeaderboard, resetUser };
