const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleCreate,
  execute(role) {
    return trackDestructiveAction(role.client, role.guild, {
      auditLogType: AuditLogEvent.RoleCreate,
      targetId: role.id,
      actionLabel: 'role creation',
    }).catch((err) => logger.error('Anti-nuke role-create tracking failed:', err));
  },
};
