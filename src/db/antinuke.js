const supabase = require('./supabase');

async function getConfig(guildId) {
  const { data, error } = await supabase.from('antinuke_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await supabase
    .from('antinuke_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function addWhitelist(guildId, id) {
  const config = (await getConfig(guildId)) ?? { whitelist_ids: [] };
  const ids = new Set(config.whitelist_ids ?? []);
  ids.add(id);
  return upsertConfig(guildId, { whitelist_ids: [...ids] });
}

async function removeWhitelist(guildId, id) {
  const config = (await getConfig(guildId)) ?? { whitelist_ids: [] };
  const ids = (config.whitelist_ids ?? []).filter((x) => x !== id);
  return upsertConfig(guildId, { whitelist_ids: ids });
}

module.exports = { getConfig, upsertConfig, addWhitelist, removeWhitelist };
