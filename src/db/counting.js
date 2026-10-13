const database = require('./database');
const { ensureGuild } = require('./guilds');
const { createExpiringCache } = require('../utils/expiringCache');

// Every message of the counting channel reads the game, so it is kept for a few seconds. What the bot writes goes into the copy at once;
// a change from the dashboard arrives on petto:invalidate (with Redis) or is seen within the 15 seconds.
// (No second level in Redis: the number must never come back older than what the bot wrote.)
const cache = createExpiringCache(15_000, { invalidateOn: ['counting_config'] });

const DEFAULTS = {
  enabled: false,
  channel_id: null,
  current_number: 0,
  last_user_id: null,
  last_message_id: null,
  high_score: 0,
  total_correct: 0,
  total_wrong: 0,
  start_number: 0,
  allow_double: false,
  math: true,
  reset_on_wrong: true,
  delete_wrong: false,
  announce_edits: true,
  react_ok: '✅',
  react_bad: '❌',
  react_record: '🏆',
  saves: 0,
  saves_max: 0,
  save_every: 100,
  milestone_every: 100,
};

async function loadConfig(guildId) {
  const { data, error } = await database.from('counting_config').select('*').eq('guild_id', String(guildId)).maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, guild_id: String(guildId), ...(data ?? {}) };
}

function getConfig(guildId) {
  return cache.get(String(guildId), () => loadConfig(guildId), { staleIfError: true });
}

/** Changes settings (or the state of the game) and remembers the new copy. */
async function updateConfig(guildId, patch) {
  await ensureGuild(String(guildId));
  const { data, error } = await database
    .from('counting_config')
    .upsert({ guild_id: String(guildId), ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw error;
  const next = { ...DEFAULTS, ...data };
  cache.set(String(guildId), next);
  return next;
}

async function bumpUser(guildId, userId, { correct = 0, wrong = 0, streak = 0 }) {
  const { data } = await database.from('counting_users').select('correct, wrong, best').eq('guild_id', String(guildId)).eq('user_id', String(userId)).maybeSingle();
  const row = { guild_id: String(guildId), user_id: String(userId), correct: (data?.correct ?? 0) + correct, wrong: (data?.wrong ?? 0) + wrong, best: Math.max(data?.best ?? 0, streak), updated_at: new Date().toISOString() };
  const { error } = await database.from('counting_users').upsert(row, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
  return row;
}

async function userStats(guildId, userId) {
  const { data, error } = await database.from('counting_users').select('*').eq('guild_id', String(guildId)).eq('user_id', String(userId)).maybeSingle();
  if (error) throw error;
  return data ?? { guild_id: String(guildId), user_id: String(userId), correct: 0, wrong: 0, best: 0 };
}

async function topUsers(guildId, limit = 10) {
  const { data, error } = await database.from('counting_users').select('*').eq('guild_id', String(guildId)).order('correct', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function resetUsers(guildId) {
  const { error } = await database.from('counting_users').delete().eq('guild_id', String(guildId));
  if (error) throw error;
}

module.exports = { DEFAULTS, getConfig, updateConfig, bumpUser, userStats, topUsers, resetUsers };
