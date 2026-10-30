const database = require('./database');
const logger = require('../utils/logger');
const { detectGuildLanguage, describeDetection } = require('../i18n/detect');

// Every row of a server that Petto never saw is made here, by `ensureGuild` (the first command, message or dashboard visit that needs it) or by
// `createGuildIfMissing` (the join). Both give it the language Petto detects for the server, whichever of them is first: a row made with the
// default 'en' by a message that came in before the join was finished would keep that language forever.
let guildLookup = null;

/** Tells this module where to find the discord.js guild of an id (`(id) => client.guilds.cache.get(id)`), so every first row can detect its language. */
function setGuildLookup(lookup) {
  guildLookup = typeof lookup === 'function' ? lookup : null;
}

function detectFor(guildId, guild) {
  try {
    const found = guild ?? guildLookup?.(guildId) ?? null;
    return found ? detectGuildLanguage(found) : null;
  } catch (err) {
    logger.warn(`Could not detect the language of server ${guildId}: ${err.message}`);
    return null;
  }
}

/**
 * Inserts the row of a server that has none. The language Petto detects goes in with `language_source: 'auto'`; `defaults` (a join) can set
 * other columns. When the insert fails because another part of Petto made the row at the same moment, that row is read and returned; when it
 * fails for another reason (a database without the new column), the plain row is tried once. Returns { row, created }.
 */
async function insertNewGuild(guildId, defaults = {}, guild = null) {
  const detection = detectFor(guildId, guild);
  const detected = detection ? { language: detection.language, language_source: 'auto' } : {};
  const { data, error } = await database
    .from('guilds')
    .insert({ ...detected, ...defaults, guild_id: guildId })
    .select('*')
    .single();
  if (!error) {
    // Once for each new server, with what was looked at (the words of the list that matched, never a member or a message).
    if (detection) {
      logger.info(`language of ${guildId}: ${describeDetection(detection)}`);
      require('../i18n').setCachedGuildLanguage(guildId, detection.language); // used at once, not when the next load of the languages runs
    }
    return { row: data, created: true };
  }

  // Another part of Petto made the row at the same moment: that one stays.
  const { data: existing } = await database.from('guilds').select('*').eq('guild_id', guildId).maybeSingle();
  if (existing) return { row: existing, created: false };
  if (!detection) throw error;
  const { data: plain, error: plainError } = await database.from('guilds').insert({ guild_id: guildId }).select('*').single();
  if (plainError) throw plainError;
  return { row: plain, created: true };
}

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

  return (await insertNewGuild(guildId)).row;
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

/** Every server that chose a language other than English, in one query: [{ guild_id, language }]. The rest are English. */
async function listGuildLanguages() {
  const { data, error } = await database
    .from('guilds')
    .select('guild_id, language')
    .neq('language', 'en');

  if (error) throw error;
  return data ?? [];
}

/**
 * Creates the config row of a server that has none (used when Petto joins a server), with the language detected for `guild` and `defaults` on
 * top. A server that already has a row keeps it untouched. Returns { row, created }.
 */
async function createGuildIfMissing(guildId, defaults = {}, guild = null) {
  const { data: existing, error: selectError } = await database
    .from('guilds')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return { row: existing, created: false };
  return insertNewGuild(guildId, defaults, guild);
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

module.exports = { ensureGuild, findGuildLanguage, listGuildLanguages, createGuildIfMissing, updateGuild, setGuildLookup };
