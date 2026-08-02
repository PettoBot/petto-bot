const supabase = require('./supabase');

async function listRoles(guildId) {
  const { data, error } = await supabase.from('join_roles').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function addRole(guildId, roleId, target = 'all') {
  const { data, error } = await supabase
    .from('join_roles')
    .upsert({ guild_id: guildId, role_id: roleId, target }, { onConflict: 'guild_id,role_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function removeRole(guildId, roleId) {
  const { data, error } = await supabase.from('join_roles').delete().eq('guild_id', guildId).eq('role_id', roleId).select('role_id');
  if (error) throw error;
  return data.length > 0;
}

async function clearRoles(guildId) {
  const { data, error } = await supabase.from('join_roles').delete().eq('guild_id', guildId).select('role_id');
  if (error) throw error;
  return data.length;
}

module.exports = { listRoles, addRole, removeRole, clearRoles };
