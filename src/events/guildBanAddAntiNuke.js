const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildBanAdd,
  execute(ban) {
    return trackDestructiveAction(ban.client, ban.guild, { auditLogType: AuditLogEvent.MemberBanAdd, targetId: ban.user.id, actionLabel: 'ban' }).catch((err) =>
      logger.error('Anti-nuke ban tracking failed:', err),
    );
  },
};
