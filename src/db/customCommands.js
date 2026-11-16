const database = require('./database');

function normalizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, '');
}

async function getCommand(guildId, name) {
  const { data, error } = await database.from('custom_commands').select('*').eq('guild_id', guildId).eq('name', normalizeName(name)).maybeSingle();
  if (error) throw error;
  return data;
}

/** The number the next command of a server gets: one more than the highest. */
async function nextNumber(guildId) {
  const { data, error } = await database.from('custom_commands').select('number').eq('guild_id', guildId).not('number', 'is', null).order('number', { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0]?.number ?? 0) + 1;
}

async function upsertCommand(guildId, name, { response, embedTemplate, code, createdBy, files }) {
  const existing = await getCommand(guildId, name);
  // A command keeps the number it was born with; only a new one takes the next.
  const number = existing?.number ?? await nextNumber(guildId);
  const { data, error } = await database
    .from('custom_commands')
    .upsert({ guild_id: guildId, name: normalizeName(name), response: response ?? null, embed_template: embedTemplate ?? null, number, ...(code !== undefined ? { code, created_by: createdBy ?? null, files: Array.isArray(files) ? files : [] } : {}) }, { onConflict: 'guild_id,name' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** A command by its name or by its number in the server (`"shop"`, `"75"`). */
async function getByRef(guildId, ref) {
  const text = String(ref ?? '').trim().replace(/^[^A-Za-z0-9_-]+/, '');
  if (!/^\d+$/.test(text)) return getCommand(guildId, text);
  const { data, error } = await database.from('custom_commands').select('*').eq('guild_id', guildId).eq('number', Number(text)).maybeSingle();
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

/** The commands that also run after this one (their names). */
async function setLinks(guildId, name, links) {
  const { data, error } = await database.from('custom_commands').update({ links }).eq('guild_id', guildId).eq('name', normalizeName(name)).select('name');
  if (error) throw error;
  return data.length > 0;
}

/** The options of a command written in code (where its mistakes go, the roles and channels it is for). */
async function setOptions(guildId, name, options) {
  const { data, error } = await database.from('custom_commands').update({ options }).eq('guild_id', guildId).eq('name', normalizeName(name)).select('name');
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
  const { data, error } = await database.from('custom_commands').select('number, name, response, embed_template, code, trigger_type, trigger_text, links, files, options').eq('guild_id', guildId).order('name', { ascending: true });
  if (error) throw error;
  return data;
}

module.exports = { normalizeName, getCommand, getByRef, upsertCommand, renameCommand, removeCommand, listCommands, listTriggers, setTrigger, setLinks, setOptions };
