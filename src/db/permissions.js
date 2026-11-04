const database = require('./database');
const { createExpiringCache } = require('../utils/expiringCache');

// Read for every command (the level of the command, the roles chosen for it), so they stay in memory for a short time and every write below forgets
// them. Without this a command made two or three queries before it did anything; a change made from the dashboard is seen within 15 seconds.
const READ_TTL_MS = 15_000;
const groupsCache = createExpiringCache(READ_TTL_MS);
const levelsCache = createExpiringCache(READ_TTL_MS);
const forget = (guildId) => { if (guildId != null) { groupsCache.delete(String(guildId)); levelsCache.delete(String(guildId)); } };
const forgetAll = () => { groupsCache.clear(); levelsCache.clear(); };

function listGroups(guildId) {
  return groupsCache.get(String(guildId), () => loadGroups(guildId));
}

async function loadGroups(guildId) {
  const { data: groups, error } = await database.from('permission_groups').select('*').eq('guild_id', guildId).order('id');
  if (error) throw error;
  if (!groups.length) return [];

  const { data: members, error: memErr } = await database
    .from('permission_group_members')
    .select('*')
    .in('group_id', groups.map((g) => g.id));
  if (memErr) throw memErr;

  return groups.map((g) => ({ ...g, members: members.filter((m) => m.group_id === g.id) }));
}

async function getOrCreateBaseGroup(guildId) {
  const cachedGroups = await listGroups(guildId).catch(() => null);
  const cachedBase = cachedGroups?.find((group) => group.is_base);
  if (cachedBase) { const { members: _members, ...row } = cachedBase; return row; }
  const { data: existing, error } = await database.from('permission_groups').select('*').eq('guild_id', guildId).eq('is_base', true).maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: insErr } = await database
    .from('permission_groups')
    .upsert({ guild_id: guildId, name: '@everyone', level: 0, is_base: true }, { onConflict: 'guild_id,name' })
    .select('*')
    .single();
  if (insErr) throw insErr;
  forget(guildId);
  return created;
}

/** The level a command asks for: every level of the server is read in one query and kept for a moment (a command asks for two or three names). */
async function getCommandLevel(guildId, commandName) {
  const levels = await levelsCache.get(String(guildId), async () => {
    const rows = await listCommandLevelsFresh(guildId);
    return new Map(rows.map((row) => [row.command_name, row.required_level]));
  });
  return levels.get(commandName) ?? 0;
}

async function listCommandLevelsFresh(guildId) {
  const { data, error } = await database.from('command_permission_levels').select('*').eq('guild_id', guildId);
  if (error) throw error;
  return data;
}

async function listCommandLevels(guildId) {
  return listCommandLevelsFresh(guildId);
}

async function setCommandLevel(guildId, commandName, requiredLevel) {
  const { data, error } = await database
    .from('command_permission_levels')
    .upsert({ guild_id: guildId, command_name: commandName, required_level: requiredLevel, updated_at: new Date().toISOString() }, { onConflict: 'guild_id,command_name' })
    .select('*')
    .single();
  if (error) throw error;
  forget(guildId);
  return data;
}

async function createGroup(guildId, name, level = 0) {
  const { data, error } = await database
    .from('permission_groups')
    .insert({ guild_id: guildId, name: String(name).trim(), level: Math.max(0, Math.min(100, Number(level) || 0)) })
    .select('*')
    .single();
  if (error) throw error;
  forget(guildId);
  return data;
}

async function deleteGroup(guildId, groupId) {
  const { data, error } = await database
    .from('permission_groups')
    .delete()
    .eq('guild_id', guildId)
    .eq('id', groupId)
    .eq('is_base', false)
    .select('id');
  if (error) throw error;
  forget(guildId);
  return data.length > 0;
}

async function updateGroupLevel(guildId, groupId, level) {
  const { data, error } = await database
    .from('permission_groups')
    .update({ level: Math.max(0, Math.min(100, Number(level) || 0)) })
    .eq('guild_id', guildId)
    .eq('id', groupId)
    .select('*')
    .single();
  if (error) throw error;
  forget(guildId);
  return data;
}

async function addGroupMember(groupId, subjectType, subjectId) {
  const { data, error } = await database
    .from('permission_group_members')
    .upsert({ group_id: groupId, subject_type: subjectType, subject_id: subjectId }, { onConflict: 'group_id,subject_type,subject_id' })
    .select('*')
    .single();
  if (error) throw error;
  forgetAll(); // a member row names its group, not its server
  return data;
}

async function removeGroupMember(groupId, subjectType, subjectId) {
  const { data, error } = await database
    .from('permission_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .select('id');
  if (error) throw error;
  forgetAll();
  return data.length > 0;
}

async function recordAudit(guildId, actor, action, summary) {
  const { error } = await database.from('permission_audit_log').insert({
    guild_id: guildId,
    actor_id: actor.id,
    actor_name: actor.username ?? actor.tag ?? actor.id,
    action,
    summary,
  });
  if (error) throw error;
}

// Highest level among every group the member belongs to, directly (user id) or via any of
// their roles, falling back to the guild's base/@everyone group (0 if that's never been touched).
async function getEffectiveLevel(guildId, member) {
  const groups = await listGroups(guildId);
  if (!groups.length) return 0;

  const roleIds = new Set(member.roles?.cache ? [...member.roles.cache.keys()] : []);
  let level = 0;
  for (const group of groups) {
    if (group.is_base) { level = Math.max(level, group.level); continue; }
    const matches = group.members.some((m) => (m.subject_type === 'user' && m.subject_id === member.id) || (m.subject_type === 'role' && roleIds.has(m.subject_id)));
    if (matches) level = Math.max(level, group.level);
  }
  return level;
}

// Server owner and Administrator-permission holders always bypass this system, so a
// misconfigured required level can never lock out the people who'd need to fix it.
async function hasCommandPermission(guildId, commandName, member) {
  if (member.guild?.ownerId === member.id) return true;
  if (member.permissions?.has('Administrator')) return true;

  const required = await getCommandLevel(guildId, commandName);
  if (required <= 0) return true;

  const level = await getEffectiveLevel(guildId, member);
  return level >= required;
}

module.exports = {
  listGroups,
  getOrCreateBaseGroup,
  getCommandLevel,
  listCommandLevels,
  setCommandLevel,
  createGroup,
  deleteGroup,
  updateGroupLevel,
  addGroupMember,
  removeGroupMember,
  recordAudit,
  getEffectiveLevel,
  hasCommandPermission,
  forget,
};
