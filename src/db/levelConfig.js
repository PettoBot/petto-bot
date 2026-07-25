const supabase = require('./supabase');

async function getConfig(guildId) {
  const { data, error } = await supabase.from('level_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Fetches (creating with defaults if needed) — most callers need the row to exist so its default rates/curve are available. */
async function ensureConfig(guildId) {
  const existing = await getConfig(guildId);
  if (existing) return existing;
  const { data, error } = await supabase.from('level_config').insert({ guild_id: guildId }).select('*').single();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await supabase
    .from('level_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

module.exports = { getConfig, ensureConfig, upsertConfig };
