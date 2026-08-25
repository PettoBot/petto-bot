// Persistence helpers for booster-role settings and member assignments.
const supabase = require('./supabase');

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

/**
 * `role_id` is NOT NULL, but most callers only ever patch color/cooldown fields on a row that
 * already exists — if the row doesn't exist yet and the caller forgot to pass role_id, that's a
 * caller bug and would otherwise surface as an opaque Postgres 23502 error. Backfilling it here
 * from the existing row (or failing loudly if there's no row and no role_id) makes every caller
 * safe by construction instead of relying on each one to remember it.
 */
async function upsertBoosterRole(guildId, userId, patch) {
  if (!patch.role_id) {
    const existing = await getBoosterRole(guildId, userId);
    if (existing) {
      patch = { ...patch, role_id: existing.role_id };
    } else {
      throw new Error(`upsertBoosterRole: no existing row for ${guildId}/${userId} and no role_id in patch — refusing to insert a broken row.`);
    }
  }

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
