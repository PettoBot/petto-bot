const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');

// A click is looked up by id, so the responders are kept for a few seconds; saving or deleting one forgets it at once.
const byIdCache = createExpiringCache(15_000);

const RESPONDER_DEFAULTS = { label: '', emoji: null, style: 'secondary', reply: '', reply_template: null, give_role_ids: [], remove_role_ids: [], required_role_ids: [], toggle: false, delete_message: false, react_emoji: null, send_channel_id: null };

async function getById(id) {
  return byIdCache.get(String(id), async () => {
    const { data, error } = await database.from('button_responders').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? { ...RESPONDER_DEFAULTS, ...data } : null;
  }, { staleIfError: true });
}

async function getByName(guildId, name) {
  const { data, error } = await database.from('button_responders').select('*').eq('guild_id', String(guildId)).eq('name', name).maybeSingle();
  if (error) throw error;
  return data ? { ...RESPONDER_DEFAULTS, ...data } : null;
}

async function listResponders(guildId) {
  const { data, error } = await database.from('button_responders').select('*').eq('guild_id', String(guildId)).order('name', { ascending: true }).limit(300);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...RESPONDER_DEFAULTS, ...row }));
}

async function countResponders(guildId) {
  const { count, error } = await database.from('button_responders').select('id', { count: 'exact', head: true }).eq('guild_id', String(guildId));
  if (error) throw error;
  return count ?? 0;
}

async function saveResponder(guildId, name, values) {
  const { data, error } = await database.from('button_responders').upsert({ ...values, guild_id: String(guildId), name }, { onConflict: 'guild_id,name' }).select('*').single();
  if (error) throw error;
  byIdCache.delete(String(data.id));
  return { ...RESPONDER_DEFAULTS, ...data };
}

async function deleteResponder(guildId, name) {
  const { data, error } = await database.from('button_responders').delete().eq('guild_id', String(guildId)).eq('name', name).select('id');
  if (error) throw error;
  for (const row of data ?? []) byIdCache.delete(String(row.id));
  return (data ?? []).length > 0;
}

const PANEL_DEFAULTS = { kind: 'buttons', content: '', embed_template: null, responders: [], placeholder: '', exclusive: false, channel_id: null, message_id: null };

async function getPanelById(id) {
  const { data, error } = await database.from('component_panels').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? { ...PANEL_DEFAULTS, ...data } : null;
}

async function getPanel(guildId, name) {
  const { data, error } = await database.from('component_panels').select('*').eq('guild_id', String(guildId)).eq('name', name).maybeSingle();
  if (error) throw error;
  return data ? { ...PANEL_DEFAULTS, ...data } : null;
}

async function listPanels(guildId) {
  const { data, error } = await database.from('component_panels').select('*').eq('guild_id', String(guildId)).order('name', { ascending: true }).limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...PANEL_DEFAULTS, ...row }));
}

async function countPanels(guildId) {
  const { count, error } = await database.from('component_panels').select('id', { count: 'exact', head: true }).eq('guild_id', String(guildId));
  if (error) throw error;
  return count ?? 0;
}

async function savePanel(guildId, name, values) {
  const { data, error } = await database.from('component_panels').upsert({ ...values, guild_id: String(guildId), name }, { onConflict: 'guild_id,name' }).select('*').single();
  if (error) throw error;
  return { ...PANEL_DEFAULTS, ...data };
}

async function deletePanel(guildId, name) {
  const { data, error } = await database.from('component_panels').delete().eq('guild_id', String(guildId)).eq('name', name).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = {
  RESPONDER_DEFAULTS, PANEL_DEFAULTS,
  getById, getByName, listResponders, countResponders, saveResponder, deleteResponder,
  getPanelById, getPanel, listPanels, countPanels, savePanel, deletePanel,
};
