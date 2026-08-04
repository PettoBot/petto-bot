const permissionsDb = require('../db/permissions');

const GROUP_PREFIX = '__petto_moderation_role__:';
const ROLE_GROUP_LEVEL = 50;

// A configured role can use the normal, single-target command in each family.
// Bulk commands intentionally are not included here: they are Administrator-only.
const ACTION_COMMANDS = {
  ban: ['ban', 'hardban', 'tempban'],
  kick: ['kick'],
  softban: ['softban'],
  unban: ['unban'],
  mute: ['mute', 'tempmute', 'timeout'],
  unmute: ['unmute'],
  warn: ['warn'],
  case: ['case'],
  note: ['note'],
  role: ['role'],
  channel: ['channel'],
  voice: ['voice'],
  nuke: ['nuke'],
};

const ACTIONS = Object.keys(ACTION_COMMANDS);

function groupName(commandName) {
  return GROUP_PREFIX + commandName;
}

function commandNamesForAction(action) {
  return ACTION_COMMANDS[action] ?? [];
}

function actionForCommand(commandName) {
  return ACTIONS.find((action) => ACTION_COMMANDS[action].includes(commandName)) ?? null;
}

async function findGroup(guildId, commandName) {
  const groups = await permissionsDb.listGroups(guildId);
  return groups.find((group) => group.name === groupName(commandName)) ?? null;
}

async function allowRole(guildId, action, roleId) {
  const commandNames = commandNamesForAction(action);
  if (!commandNames.length) return false;

  await permissionsDb.getOrCreateBaseGroup(guildId);
  for (const commandName of commandNames) {
    let group = await findGroup(guildId, commandName);
    if (!group) group = await permissionsDb.createGroup(guildId, groupName(commandName), ROLE_GROUP_LEVEL);
    await permissionsDb.addGroupMember(group.id, 'role', roleId);
  }
  return true;
}

async function denyRole(guildId, action, roleId) {
  const commandNames = commandNamesForAction(action);
  let removed = false;
  for (const commandName of commandNames) {
    const group = await findGroup(guildId, commandName);
    if (!group) continue;
    removed = (await permissionsDb.removeGroupMember(group.id, 'role', roleId)) || removed;
    const remaining = await findGroup(guildId, commandName);
    if (remaining && remaining.members.length === 0) await permissionsDb.deleteGroup(guildId, remaining.id);
  }
  return removed;
}

async function resetAction(guildId, action) {
  let removed = false;
  for (const commandName of commandNamesForAction(action)) {
    const group = await findGroup(guildId, commandName);
    if (!group) continue;
    removed = true;
    await permissionsDb.deleteGroup(guildId, group.id);
  }
  return removed;
}

async function listActionRoles(guildId) {
  const groups = await permissionsDb.listGroups(guildId);
  return ACTIONS.map((action) => {
    const roles = commandNamesForAction(action)
      .map((commandName) => groups.find((group) => group.name === groupName(commandName)))
      .filter(Boolean)
      .flatMap((group) => group.members.filter((member) => member.subject_type === 'role').map((member) => member.subject_id));
    return { action, roles: [...new Set(roles)] };
  }).filter((entry) => entry.roles.length);
}

async function hasConfiguredRole(guildId, commandName, member) {
  if (!member || !actionForCommand(commandName)) return false;
  if (member.guild?.ownerId === member.id || member.permissions?.has('Administrator')) return true;

  const group = await findGroup(guildId, commandName);
  if (!group) return false;
  const roleIds = new Set(member.roles?.cache ? [...member.roles.cache.keys()] : []);
  return group.members.some((entry) => entry.subject_type === 'role' && roleIds.has(entry.subject_id));
}

module.exports = {
  ACTION_COMMANDS,
  ACTIONS,
  actionForCommand,
  allowRole,
  denyRole,
  resetAction,
  listActionRoles,
  hasConfiguredRole,
};
