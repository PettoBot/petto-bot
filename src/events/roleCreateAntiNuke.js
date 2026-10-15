const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildRoleCreate,
  execute(role) {
    return trackDestructiveAction(role.client, role.guild, {
      auditLogType: AuditLogEvent.RoleCreate,
      targetId: role.id,
      rule: 'role_create',
      actionLabel: t(currentLanguage(), 'security.antinuke.detail.roleCreate'),
      undo: { kind: 'delete_role', id: role.id },
    }).catch((err) => logger.error('Anti-nuke role-create tracking failed:', err));
  },
};
