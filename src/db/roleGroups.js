const supabase = require('./supabase');

async function listGroups(guildId) {
  const { data, error } = await supabase.from('role_groups').select('*').eq('guild_id', guildId).order('name');
  if (error) throw error;
  return data;
}

async function getGroup(guildId, name) {
  const { data, error } = await supabase.from('role_groups').select('*').eq('guild_id', guildId).eq('name', name).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertGroup(guildId, name, roleIds) {
  const { data, error } = await supabase
    .from('role_groups')
    .upsert({ guild_id: guildId, name, role_ids: roleIds }, { onConflict: 'guild_id,name' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function deleteGroup(guildId, name) {
  const { data, error } = await supabase.from('role_groups').delete().eq('guild_id', guildId).eq('name', name).select('name');
  if (error) throw error;
  return data.length > 0;
}

module.exports = { listGroups, getGroup, upsertGroup, deleteGroup };
