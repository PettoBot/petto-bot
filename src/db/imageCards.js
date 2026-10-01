const database = require('./database');

function normalizeName(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40);
}

async function listCards(guildId) {
  const { data, error } = await database.from('image_cards').select('name, data, updated_at').eq('guild_id', guildId).order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function getCard(guildId, name) {
  const { data, error } = await database.from('image_cards').select('*').eq('guild_id', guildId).eq('name', normalizeName(name)).maybeSingle();
  if (error) throw error;
  return data;
}

async function countCards(guildId) {
  const { data, error } = await database.from('image_cards').select('id').eq('guild_id', guildId);
  if (error) throw error;
  return (data ?? []).length;
}

/** Creates a card or replaces the data of the one with that name. */
async function saveCard(guildId, name, data, createdBy = null) {
  const { data: row, error } = await database
    .from('image_cards')
    .upsert({ guild_id: guildId, name: normalizeName(name), data, created_by: createdBy, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,name' })
    .select('*')
    .single();
  if (error) throw error;
  return row;
}

async function deleteCard(guildId, name) {
  const { data, error } = await database.from('image_cards').delete().eq('guild_id', guildId).eq('name', normalizeName(name)).select('name');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = { normalizeName, listCards, getCard, countCards, saveCard, deleteCard };
