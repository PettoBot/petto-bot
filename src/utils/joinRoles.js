// Giving the join roles of a server to a member: when they join, and, for the roles that wait for the rules, when they accept them.
const { PermissionFlagsBits } = require('discord.js');
const joinRolesDb = require('../db/joinRoles');
const { addRoles, isGone, reportDeadRoles } = require('./deadRoles');
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

const FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Gives the member the roles of these rows that can be given: the ones that were deleted are left out and the staff is told (utils/deadRoles.js), the ones
 * that are above Petto or managed are left out, the ones the member already has are not asked again. A refusal is logged with the error itself, so the
 * triage of errors knows what it is (a role above Petto is the server's to fix, anything else is looked at).
 */
async function giveJoinRoles(member, rows, reason = t(currentLanguage(), 'welcome.joinRole.auditReason')) {
  const guild = member.guild;
  const me = guild.members.me;
  const eligible = rows.filter((row) => row.target === 'all' || (row.target === 'bots' ? member.user.bot : !member.user.bot));
  const gone = eligible.filter((row) => isGone(guild, row.role_id)).map((row) => row.role_id);
  const roles = eligible
    .map((row) => guild.roles.cache.get(row.role_id))
    .filter((role) => role && role.position < me.roles.highest.position && !role.managed && !member.roles?.cache?.has?.(role.id));
  const result = await addRoles(member, roles, reason);
  if (result.error) logger.warn(`Join role assignment failed for ${member.id} in guild ${guild.id}:`, result.error);
  gone.push(...result.dead);
  if (gone.length) await reportDeadRoles({ client: member.client, guild, kind: 'join', roleIds: gone, forget: (roleId) => joinRolesDb.removeRole(guild.id, roleId) });
  return result;
}

/** Whether Petto may change roles in this server at all. */
function canGiveRoles(guild) {
  return Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles));
}

module.exports = { FRESH_MS, giveJoinRoles, canGiveRoles };
