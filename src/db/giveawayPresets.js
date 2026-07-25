const supabase = require('./supabase');

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

async function createPreset(guildId, name) {
  const { data, error } = await supabase.from('giveaway_presets').insert({ guild_id: guildId, name: normalizeName(name) }).select('*').single();
  if (error) throw error;
  return data;
}

async function getPreset(guildId, name) {
  const { data, error } = await supabase.from('giveaway_presets').select('*').eq('guild_id', guildId).eq('name', normalizeName(name)).maybeSingle();
  if (error) throw error;
  return data;
}

async function getPresetById(id) {
  const { data, error } = await supabase.from('giveaway_presets').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function removePreset(guildId, name) {
  const { data, error } = await supabase.from('giveaway_presets').delete().eq('guild_id', guildId).eq('name', normalizeName(name)).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function listPresets(guildId) {
  const { data, error } = await supabase.from('giveaway_presets').select('*').eq('guild_id', guildId).order('name', { ascending: true });
  if (error) throw error;
  return data;
}

async function listRoles(presetId) {
  const { data, error } = await supabase.from('giveaway_preset_roles').select('*').eq('preset_id', presetId);
  if (error) throw error;
  return data;
}

async function upsertRole(presetId, roleId, { claimTimeMs, entries, claimTimeStack, entriesStack }) {
  const { data, error } = await supabase
    .from('giveaway_preset_roles')
    .upsert(
      { preset_id: presetId, role_id: roleId, claim_time_ms: claimTimeMs ?? 0, entries: entries ?? 0, claim_time_stack: claimTimeStack ?? false, entries_stack: entriesStack ?? false },
      { onConflict: 'preset_id,role_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function removeRole(presetId, roleId) {
  const { data, error } = await supabase.from('giveaway_preset_roles').delete().eq('preset_id', presetId).eq('role_id', roleId).select('role_id');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { normalizeName, createPreset, getPreset, getPresetById, removePreset, listPresets, listRoles, upsertRole, removeRole };
