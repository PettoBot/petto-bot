// The storage of a reaction board (the starboard, the monkeyboard): one settings row per server and one row per message that made it.
// Each board has its own two tables; this holds what they share.
const database = require('./database');

function createBoardStore({ configTable, entriesTable, defaults }) {
  async function getConfig(guildId) {
    const { data, error } = await database.from(configTable).select('*').eq('guild_id', guildId).maybeSingle();
    if (error) throw error;
    return data ? { ...defaults, ...data } : null;
  }

  async function ensureConfig(guildId) {
    const existing = await getConfig(guildId);
    if (existing) return existing;
    const { data, error } = await database.from(configTable).insert({ guild_id: guildId, ...defaults }).select('*').single();
    if (error) throw error;
    return { ...defaults, ...data };
  }

  async function updateConfig(guildId, changes) {
    const { data, error } = await database.from(configTable).upsert({ guild_id: guildId, ...changes }, { onConflict: 'guild_id' }).select('*').single();
    if (error) throw error;
    return { ...defaults, ...data };
  }

  async function disable(guildId) {
    const { error: entriesError } = await database.from(entriesTable).delete().eq('guild_id', guildId);
    if (entriesError) throw entriesError;
    const { error } = await database.from(configTable).delete().eq('guild_id', guildId);
    if (error) throw error;
  }

  async function getEntry(guildId, sourceMessageId) {
    const { data, error } = await database.from(entriesTable).select('*').eq('guild_id', guildId).eq('source_message_id', sourceMessageId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function saveEntry({ guildId, sourceMessageId, starboardMessageId, count }) {
    const { data, error } = await database.from(entriesTable).upsert({ guild_id: guildId, source_message_id: sourceMessageId, starboard_message_id: starboardMessageId, count, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,source_message_id' }).select('*').single();
    if (error) throw error;
    return data;
  }

  async function removeEntry(guildId, sourceMessageId) {
    const { error } = await database.from(entriesTable).delete().eq('guild_id', guildId).eq('source_message_id', sourceMessageId);
    if (error) throw error;
  }

  return { DEFAULTS: defaults, getConfig, ensureConfig, updateConfig, disable, getEntry, saveEntry, removeEntry };
}

module.exports = { createBoardStore };
