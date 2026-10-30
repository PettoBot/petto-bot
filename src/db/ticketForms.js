const database = require('./database');
const { t, currentLanguage } = require('../i18n');

// The questions of a form (their types, limits and checks) are in utils/ticketFormFields.js; here they are only saved and read.
const { FIELD_TYPES: TYPES, normalizeFields } = require('../utils/ticketFormFields');

const FIELD_TYPES = new Set(TYPES);

function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

async function createForm({ guildId, name, title, fields }) {
  const normalizedName = normalizeName(name);
  const normalizedFields = normalizeFields(fields);
  if (!normalizedName) throw new Error(t(currentLanguage(), 'tickets.db.form.nameRequired'));
  const { data, error } = await database.from('ticket_forms').insert({ guild_id: guildId, name: normalizedName, title: String(title || 'Ticket details').slice(0, 45), fields: normalizedFields }).select('*').single(); // i18n-ignore: English default kept in the database, shown translated (defaultText)
  if (error) throw error;
  return data;
}

async function getFormByName(guildId, name) {
  const { data, error } = await database.from('ticket_forms').select('*').eq('guild_id', guildId).eq('name', normalizeName(name)).maybeSingle();
  if (error) throw error;
  return data;
}

async function getFormById(id) {
  const { data, error } = await database.from('ticket_forms').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function listForms(guildId) {
  const { data, error } = await database.from('ticket_forms').select('*').eq('guild_id', guildId).order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function updateForm(guildId, name, patch) {
  const update = { ...patch, updated_at: new Date().toISOString() };
  if (update.fields) update.fields = normalizeFields(update.fields);
  if (update.title) update.title = String(update.title).slice(0, 45);
  const { data, error } = await database.from('ticket_forms').update(update).eq('guild_id', guildId).eq('name', normalizeName(name)).select('*').single();
  if (error) throw error;
  return data;
}

async function deleteForm(guildId, name) {
  const { data, error } = await database.from('ticket_forms').delete().eq('guild_id', guildId).eq('name', normalizeName(name)).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = { FIELD_TYPES, normalizeName, normalizeFields, createForm, getFormByName, getFormById, listForms, updateForm, deleteForm };
