const supabase = require('./supabase');

async function listRewards(guildId) {
  const { data, error } = await supabase.from('level_rewards').select('*').eq('guild_id', guildId).order('level', { ascending: true });
  if (error) throw error;
  return data;
}

async function setReward(guildId, level, roleId) {
  const { data, error } = await supabase.from('level_rewards').upsert({ guild_id: guildId, level, role_id: roleId }, { onConflict: 'guild_id,level' }).select('*').single();
  if (error) throw error;
  return data;
}

async function removeReward(guildId, level) {
  const { data, error } = await supabase.from('level_rewards').delete().eq('guild_id', guildId).eq('level', level).select('level');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { listRewards, setReward, removeReward };
