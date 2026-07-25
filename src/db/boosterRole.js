const supabase = require('./supabase');

// ── Per-guild config ─────────────────────────────────────────────────────────

async function getConfig(guildId) {
  const { data, error } = await supabase.from('booster_role_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Fetches (creating with defaults if needed) — callers need the row to exist so its default cooldown/limit values are available. */
async function ensureConfig(guildId) {
  const existing = await getConfig(guildId);
  if (existing) return existing;
  const { data, error } = await supabase.from('booster_role_config').insert({ guild_id: guildId }).select('*').single();
  if (error) throw error;
  return data;
}

async function upsertConfig(guildId, patch) {
  const { data, error } = await supabase
    .from('booster_role_config')
    .upsert({ guild_id: guildId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// ── Per-member booster role ─────────────────────────────────────────────────

async function getBoosterRole(guildId, userId) {
  const { data, error } = await supabase.from('booster_roles').select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getBoosterRoleByRoleId(guildId, roleId) {
  const { data, error } = await supabase.from('booster_roles').select('*').eq('guild_id', guildId).eq('role_id', roleId).maybeSingle();
  if (error) throw error;
  return data;
}

async function listBoosterRoles(guildId) {
  const { data, error } = await supabase.from('booster_roles').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function countBoosterRoles(guildId, userId) {
  const { count, error } = await supabase.from('booster_roles').select('id', { count: 'exact', head: true }).eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
  return count ?? 0;
}

async function upsertBoosterRole(guildId, userId, patch) {
  const { data, error } = await supabase
    .from('booster_roles')
    .upsert({ guild_id: guildId, user_id: userId, ...patch }, { onConflict: 'guild_id,user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function deleteBoosterRole(guildId, userId) {
  const { error } = await supabase.from('booster_roles').delete().eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
}

module.exports = {
  getConfig,
  ensureConfig,
  upsertConfig,
  getBoosterRole,
  getBoosterRoleByRoleId,
  listBoosterRoles,
  countBoosterRoles,
  upsertBoosterRole,
  deleteBoosterRole,
};
