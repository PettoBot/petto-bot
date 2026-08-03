const supabase = require('./supabase');

const FIELD_TYPES = new Set(['short_text', 'long_text']);

function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

function normalizeFields(fields) {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 5) throw new Error('A form needs between 1 and 5 fields.');
  return fields.map((field, index) => {
    const type = String(field.type ?? 'short_text').trim().toLowerCase();
    if (!FIELD_TYPES.has(type)) throw new Error(`Field ${index + 1} must use short_text or long_text.`);
    const id = String(field.id ?? field.label ?? `field_${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 40);
    const label = String(field.label ?? '').trim().slice(0, 45);
    if (!id || !label) throw new Error(`Field ${index + 1} needs an id and label.`);
    return {
      id,
      type,
      label,
      placeholder: String(field.placeholder ?? '').trim().slice(0, 100) || undefined,
      required: field.required !== false,
    };
  });
}

async function createForm({ guildId, name, title, fields }) {
  const normalizedName = normalizeName(name);
  const normalizedFields = normalizeFields(fields);
  if (!normalizedName) throw new Error('Form name is required.');
  const { data, error } = await supabase.from('ticket_forms').insert({ guild_id: guildId, name: normalizedName, title: String(title || 'Ticket details').slice(0, 45), fields: normalizedFields }).select('*').single();
  if (error) throw error;
  return data;
}

async function getFormByName(guildId, name) {
  const { data, error } = await supabase.from('ticket_forms').select('*').eq('guild_id', guildId).eq('name', normalizeName(name)).maybeSingle();
  if (error) throw error;
  return data;
}

async function getFormById(id) {
  const { data, error } = await supabase.from('ticket_forms').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function listForms(guildId) {
  const { data, error } = await supabase.from('ticket_forms').select('*').eq('guild_id', guildId).order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function updateForm(guildId, name, patch) {
  const update = { ...patch, updated_at: new Date().toISOString() };
  if (update.fields) update.fields = normalizeFields(update.fields);
  if (update.title) update.title = String(update.title).slice(0, 45);
  const { data, error } = await supabase.from('ticket_forms').update(update).eq('guild_id', guildId).eq('name', normalizeName(name)).select('*').single();
  if (error) throw error;
  return data;
}

async function deleteForm(guildId, name) {
  const { data, error } = await supabase.from('ticket_forms').delete().eq('guild_id', guildId).eq('name', normalizeName(name)).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = { FIELD_TYPES, normalizeName, normalizeFields, createForm, getFormByName, getFormById, listForms, updateForm, deleteForm };
