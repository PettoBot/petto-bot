const database = require('./database');

function normalizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, '');
}

async function getCommand(guildId, name) {
  const { data, error } = await database.from('custom_commands').select('*').eq('guild_id', guildId).eq('name', normalizeName(name)).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertCommand(guildId, name, { response, embedTemplate, code, createdBy }) {
  const { data, error } = await database
    .from('custom_commands')
    .upsert({ guild_id: guildId, name: normalizeName(name), response: response ?? null, embed_template: embedTemplate ?? null, ...(code !== undefined ? { code, created_by: createdBy ?? null } : {}) }, { onConflict: 'guild_id,name' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function removeCommand(guildId, name) {
  const { data, error } = await database.from('custom_commands').delete().eq('guild_id', guildId).eq('name', normalizeName(name)).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function listCommands(guildId) {
  const { data, error } = await database.from('custom_commands').select('name, response, embed_template, code').eq('guild_id', guildId).order('name', { ascending: true });
  if (error) throw error;
  return data;
}

module.exports = { normalizeName, getCommand, upsertCommand, removeCommand, listCommands };
