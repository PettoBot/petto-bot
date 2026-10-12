const database = require('./database');

const SOURCES = ['text', 'voice'];
const sourceOf = (value) => (value === 'voice' ? 'voice' : 'text');

/** The reward roles of the message levels (`text`, the default) or of the voice levels (`voice`). `all` gives both. */
async function listRewards(guildId, source = 'text') {
  let query = database.from('level_rewards').select('*').eq('guild_id', guildId);
  if (source !== 'all') query = query.eq('source', sourceOf(source));
  const { data, error } = await query.order('level', { ascending: true });
  if (error) throw error;
  return data;
}

async function setReward(guildId, level, roleId, source = 'text') {
  const { data, error } = await database.from('level_rewards').upsert({ guild_id: guildId, source: sourceOf(source), level, role_id: roleId }, { onConflict: 'guild_id,source,level' }).select('*').single();
  if (error) throw error;
  return data;
}

async function removeReward(guildId, level, source = 'text') {
  const { data, error } = await database.from('level_rewards').delete().eq('guild_id', guildId).eq('source', sourceOf(source)).eq('level', level).select('level');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { SOURCES, listRewards, setReward, removeReward };
