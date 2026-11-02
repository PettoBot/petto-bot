// Giving the role of who passes the verification, when the role the server chose may have been deleted since.
// The member passed, so the answer is never "contact a moderator" because of a role that is gone:
//   1. the role is made again (same name and look as the one the dashboard makes, no permissions, below Petto's own role) when Petto may
//      manage roles and the server has room, saved in the verification settings and given to the member, and the staff is told;
//   2. when that is not possible, the member still counts as verified (the single-use claim is the record Petto keeps), is told in a friendly
//      way that the server has no role set up yet, and the staff is told, once a day, what to do. Nothing is retried for every member.
// A role that is only refused for another reason (a permission, the role above Petto's) is still an error, as it always was.
const { PermissionFlagsBits } = require('discord.js');
const { getConfig, upsertConfig } = require('../db/verificationConfig');
const { isUnknownRole, reportDeadRoles, tellStaff } = require('./deadRoles');
const logger = require('./logger');
const { t } = require('../i18n');

const MAX_ROLES = 250; // the most roles a server can have
const making = new Map(); // guildId -> the promise of the role being made: members who verify together share one new role

/** The new role for who passes (null when it cannot be made: no Manage Roles permission, or the server is at its limit of roles). */
async function makeVerifiedRole(guild, lang) {
  if (!guild.members?.me?.permissions?.has(PermissionFlagsBits.ManageRoles)) return null;
  if ((guild.roles?.cache?.size ?? 0) >= MAX_ROLES) return null;
  try {
    const role = await guild.roles.create({ name: t(lang, 'verify.role.verified'), color: 0x57f287, permissions: [], reason: t(lang, 'verify.reason.healed') });
    await upsertConfig(guild.id, { verified_role_id: role.id });
    return role;
  } catch (error) {
    logger.warn(`Could not make the verified role again in ${guild.id}: ${error.message}`);
    return null;
  }
}

/** The role that replaces a deleted one: one made a moment ago by another member's turn, or a new one. Null when there is none. */
async function replacementRole(guild, deadId, lang) {
  const fresh = await getConfig(guild.id).catch(() => null);
  const current = fresh?.verified_role_id;
  if (current && current !== deadId && guild.roles?.cache?.has(current)) return guild.roles.cache.get(current);
  const running = making.get(guild.id);
  if (running) return running;
  const promise = makeVerifiedRole(guild, lang).finally(() => making.delete(guild.id));
  making.set(guild.id, promise);
  return promise;
}

/**
 * Gives `member` the verified role of the settings. Returns { given, healed, dead }: `given` when the member has a role now (or the server has
 * chosen none, which is a valid setup), `healed` when a new role was made, `dead` when the role is gone and no other could be given.
 * Throws for any other failure of Discord, as before.
 */
async function giveVerifiedRole({ client, guild, member, settings, lang, reason }) {
  const roleId = settings?.verified_role_id;
  if (!roleId) return { given: true, healed: false, dead: false };
  try {
    await member.roles.add(roleId, reason);
    return { given: true, healed: false, dead: false };
  } catch (error) {
    if (!isUnknownRole(error)) throw error;
  }

  const role = await replacementRole(guild, roleId, lang);
  if (role) {
    await member.roles.add(role.id, reason);
    await tellStaff({ client, guild, kind: 'verification', roleId, outcome: 'made', name: role.name });
    return { given: true, healed: true, dead: false };
  }
  // The role cannot be made again: the staff is told, and the dead id is taken out of the settings only when the staff could be told.
  await reportDeadRoles({ client, guild, kind: 'verification', roleIds: [roleId], forget: async () => { await upsertConfig(guild.id, { verified_role_id: null }); } });
  return { given: false, healed: false, dead: true };
}

module.exports = { giveVerifiedRole, makeVerifiedRole };
