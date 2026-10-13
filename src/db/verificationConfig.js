const database = require('./database');

async function getConfig(guildId) {
  const { data, error } = await database.from('verification_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await database
    .from('verification_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/** The servers that want a verification panel in a channel (the dashboard or the command asked for it). */
async function listWithPanel() {
  const { data, error } = await database.from('verification_config').select('*').eq('enabled', true);
  if (error) throw error;
  return (data ?? []).filter((row) => row.panel_channel_id || row.panel_posted_channel_id);
}

module.exports = { getConfig, upsertConfig, listWithPanel };
