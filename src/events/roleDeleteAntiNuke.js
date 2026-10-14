const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const { snapshotRole } = require('../utils/antiNukeRestore');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleDelete,
  execute(role) {
    return trackDestructiveAction(role.client, role.guild, { rule: 'role_delete', auditLogType: AuditLogEvent.RoleDelete, targetId: role.id, actionLabel: 'role deletion', undo: snapshotRole(role) }).catch((err) =>
      logger.error('Anti-nuke role-delete tracking failed:', err),
    );
  },
};
