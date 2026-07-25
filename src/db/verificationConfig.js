const supabase = require('./supabase');

async function getConfig(guildId) {
  const { data, error } = await supabase.from('verification_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await supabase
    .from('verification_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

module.exports = { getConfig, upsertConfig };
