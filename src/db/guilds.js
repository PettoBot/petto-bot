const database = require('./database');

/**
 * Fetches a guild's config row, creating it with defaults on first use.
 * Every module that needs per-guild config should go through this so
 * "no row yet" never has to be special-cased at the call site.
 */
async function ensureGuild(guildId) {
  const { data: existing, error: selectError } = await database
    .from('guilds')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await database
    .from('guilds')
    .insert({ guild_id: guildId })
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}

async function updateGuild(guildId, patch) {
  const { data, error } = await database
    .from('guilds')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

module.exports = { ensureGuild, updateGuild };
