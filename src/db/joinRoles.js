const database = require('./database');

async function listRoles(guildId) {
  const { data, error } = await database.from('join_roles').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

/** `afterRules`: the role is given when the member accepts the rules of the server (Membership Screening), not at the join. */
async function addRole(guildId, roleId, target = 'all', afterRules = false) {
  const { data, error } = await database
    .from('join_roles')
    .upsert({ guild_id: guildId, role_id: roleId, target, after_rules: Boolean(afterRules) }, { onConflict: 'guild_id,role_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function removeRole(guildId, roleId) {
  const { data, error } = await database.from('join_roles').delete().eq('guild_id', guildId).eq('role_id', roleId).select('role_id');
  if (error) throw error;
  return data.length > 0;
}

async function clearRoles(guildId) {
  const { data, error } = await database.from('join_roles').delete().eq('guild_id', guildId).select('role_id');
  if (error) throw error;
  return data.length;
}

module.exports = { listRoles, addRole, removeRole, clearRoles };
