const supabase = require('./supabase');
const { createExpiringCache } = require('../utils/expiringCache');

const configCache = createExpiringCache(15_000);

async function getConfig(guildId, { force = false } = {}) {
  return configCache.get(guildId, async () => {
    const { data, error } = await supabase.from('level_config').select('*').eq('guild_id', guildId).maybeSingle();
    if (error) throw error;
    return data;
  }, { force });
}

/** Fetches (creating with defaults if needed) — most callers need the row to exist so its default rates/curve are available. */
async function ensureConfig(guildId) {
  const existing = await getConfig(guildId);
  if (existing) return existing;
  const { data, error } = await supabase.from('level_config').insert({ guild_id: guildId }).select('*').single();
  if (error) throw error;
  configCache.set(guildId, data);
  return data;
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await supabase
    .from('level_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  configCache.set(guildId, data);
  return data;
}

module.exports = { getConfig, ensureConfig, upsertConfig };
