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

/** The language saved for a server, or null when it has no row yet (read only: it never creates the row). */
async function findGuildLanguage(guildId) {
  const { data, error } = await database
    .from('guilds')
    .select('language')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) throw error;
  return data?.language ?? null;
}

/**
 * Creates the config row of a server that has none, with `defaults` (used when Petto joins a server). A server that already
 * has a row keeps it untouched. Returns { row, created }.
 */
async function createGuildIfMissing(guildId, defaults = {}) {
  const { data: existing, error: selectError } = await database
    .from('guilds')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return { row: existing, created: false };

  const { data: created, error: insertError } = await database
    .from('guilds')
    .insert({ ...defaults, guild_id: guildId })
    .select('*')
    .single();

  // Another part of Petto made the row at the same moment: that one stays.
  if (insertError) return { row: await ensureGuild(guildId), created: false };
  return { row: created, created: true };
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

module.exports = { ensureGuild, findGuildLanguage, createGuildIfMissing, updateGuild };
