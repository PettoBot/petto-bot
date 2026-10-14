const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const { track } = require('../utils/antiNuke');
const logger = require('../utils/logger');

const DANGEROUS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.MentionEveryone,
];

// A role with dangerous permissions given to somebody: the audit log says who gave it. With the protection on, the role is taken back.
module.exports = {
  name: Events.GuildMemberUpdate,
  execute(oldMember, newMember) {
    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id) && role.id !== newMember.guild.id && DANGEROUS.some((flag) => role.permissions.has(flag)));
    if (!added.size) return;
    return track(newMember.client, newMember.guild, {
      rule: 'role_assign',
      auditLogType: AuditLogEvent.MemberRoleUpdate,
      targetId: newMember.id,
      actionLabel: `dangerous role given (${added.map((r) => r.name).join(', ')})`,
      inline: [{ kind: 'remove_roles', userId: newMember.id, roleIds: added.map((r) => r.id) }],
    }).catch((err) => logger.error('Anti-nuke role-assign tracking failed:', err));
  },
};
