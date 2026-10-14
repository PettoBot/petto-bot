const { Events, AuditLogEvent } = require('discord.js');
const { track } = require('../utils/antiNuke');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildBanRemove,
  execute(ban) {
    return track(ban.client, ban.guild, {
      rule: 'unban',
      auditLogType: AuditLogEvent.MemberBanRemove,
      targetId: ban.user.id,
      actionLabel: 'unban',
      undo: { kind: 'reban', userId: ban.user.id },
    }).catch((err) => logger.error('Anti-nuke unban tracking failed:', err));
  },
};
