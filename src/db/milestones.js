// Milestone rewards of partners and uploads: a role (and a message) for who reaches a number. `claim` records that a member was given a
// milestone: the primary key makes it happen once, even when two messages arrive at the same moment.
const database = require('./database');

const KINDS = Object.freeze(['partner', 'upload']);
const MAX_REWARDS = 25;
const UNIQUE_VIOLATION = '23505';

async function list(guildId, kind) {
  const { data, error } = await database.from('milestone_rewards').select('count,role_id,message').eq('guild_id', String(guildId)).eq('kind', kind).order('count', { ascending: true }).limit(100);
  if (error) throw error;
  return data ?? [];
}

async function upsert(guildId, kind, count, roleId, message) {
  const { error } = await database.from('milestone_rewards').upsert({ guild_id: String(guildId), kind, count, role_id: String(roleId), message: message || null }, { onConflict: 'guild_id,kind,count' });
  if (error) throw error;
}

async function remove(guildId, kind, count) {
  const { data, error } = await database.from('milestone_rewards').delete().eq('guild_id', String(guildId)).eq('kind', kind).eq('count', count).select('count');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** True when this member was not given that milestone yet (and now is recorded as given); false when it was already given. */
async function claim(guildId, kind, userId, count) {
  const { error } = await database.from('milestone_awards').insert({ guild_id: String(guildId), kind, user_id: String(userId), count });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw error;
}

/** Takes the record back, so the milestone is tried again later (the role could not be given for now). */
async function release(guildId, kind, userId, count) {
  const { error } = await database.from('milestone_awards').delete().eq('guild_id', String(guildId)).eq('kind', kind).eq('user_id', String(userId)).eq('count', count);
  if (error) throw error;
}

/** The milestones this member was given. */
async function given(guildId, kind, userId) {
  const { data, error } = await database.from('milestone_awards').select('count').eq('guild_id', String(guildId)).eq('kind', kind).eq('user_id', String(userId)).limit(200);
  if (error) throw error;
  return (data ?? []).map((row) => row.count);
}

module.exports = { KINDS, MAX_REWARDS, list, upsert, remove, claim, release, given };
