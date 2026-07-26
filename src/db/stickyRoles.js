const supabase = require('./supabase');

async function getConfig(guildId) {
  const { data, error } = await supabase.from('sticky_roles_config').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data;
}

async function setEnabled(guildId, enabled) {
  const { data, error } = await supabase.from('sticky_roles_config').upsert({ guild_id: guildId, enabled }, { onConflict: 'guild_id' }).select('*').single();
  if (error) throw error;
  return data;
}

/** Called on member leave, replaces any previous snapshot for this member. */
async function saveSnapshot(guildId, userId, roleIds) {
  if (roleIds.length === 0) {
    await supabase.from('sticky_role_snapshots').delete().eq('guild_id', guildId).eq('user_id', userId);
    return;
  }
  const { error } = await supabase
    .from('sticky_role_snapshots')
    .upsert({ guild_id: guildId, user_id: userId, role_ids: roleIds, left_at: new Date().toISOString() }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;
}

/** Reads and deletes in one go, a snapshot is only ever meant to be used once. */
async function takeSnapshot(guildId, userId) {
  const { data, error } = await supabase.from('sticky_role_snapshots').select('role_ids, left_at').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await supabase.from('sticky_role_snapshots').delete().eq('guild_id', guildId).eq('user_id', userId);
  return data;
}

module.exports = { getConfig, setEnabled, saveSnapshot, takeSnapshot };
