const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleDelete,
  execute(role) {
    return trackDestructiveAction(role.client, role.guild, { auditLogType: AuditLogEvent.RoleDelete, targetId: role.id, actionLabel: 'role deletion' }).catch((err) =>
      logger.error('Anti-nuke role-delete tracking failed:', err),
    );
  },
};
