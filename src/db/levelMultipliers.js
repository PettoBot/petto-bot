const supabase = require('./supabase');
const { createExpiringCache } = require('../utils/expiringCache');

const multiplierCache = createExpiringCache(30_000);

async function listMultipliers(guildId) {
  return multiplierCache.get(guildId, async () => {
    const { data, error } = await supabase.from('level_multipliers').select('*').eq('guild_id', guildId);
    if (error) throw error;
    return data ?? [];
  });
}

async function setMultiplier(guildId, targetId, targetType, multiplier) {
  const { data, error } = await supabase
    .from('level_multipliers')
    .upsert({ guild_id: guildId, target_id: targetId, target_type: targetType, multiplier }, { onConflict: 'guild_id,target_id' })
    .select('*')
    .single();

  if (error) throw error;
  multiplierCache.delete(guildId);
  return data;
}

async function removeMultiplier(guildId, targetId) {
  const { data, error } = await supabase.from('level_multipliers').delete().eq('guild_id', guildId).eq('target_id', targetId).select('target_id');
  if (error) throw error;
  multiplierCache.delete(guildId);
  return data.length > 0;
}

module.exports = { listMultipliers, setMultiplier, removeMultiplier };
