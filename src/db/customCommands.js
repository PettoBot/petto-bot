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

/** The commands of a server that start on something other than the prefix of Petto. */
async function listTriggers(guildId) {
  const { data, error } = await database.from('custom_commands').select('*').eq('guild_id', guildId).neq('trigger_type', 'command');
  if (error) throw error;
  return data;
}

async function setTrigger(guildId, name, type, text) {
  const { data, error } = await database.from('custom_commands').update({ trigger_type: type, trigger_text: text ?? null }).eq('guild_id', guildId).eq('name', normalizeName(name)).select('name');
  if (error) throw error;
  return data.length > 0;
}

/** Changes the name of a command. Returns false when there is no command with the old name, and throws when the new name is taken. */
async function renameCommand(guildId, oldName, newName) {
  const { data, error } = await database.from('custom_commands').update({ name: normalizeName(newName) }).eq('guild_id', guildId).eq('name', normalizeName(oldName)).select('name');
  if (error) throw error;
  return data.length > 0;
}

async function removeCommand(guildId, name) {
  const { data, error } = await database.from('custom_commands').delete().eq('guild_id', guildId).eq('name', normalizeName(name)).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function listCommands(guildId) {
  const { data, error } = await database.from('custom_commands').select('name, response, embed_template, code, trigger_type, trigger_text').eq('guild_id', guildId).order('name', { ascending: true });
  if (error) throw error;
  return data;
}

module.exports = { normalizeName, getCommand, upsertCommand, renameCommand, removeCommand, listCommands, listTriggers, setTrigger };
