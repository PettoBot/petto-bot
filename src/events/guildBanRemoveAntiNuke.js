const { Events, AuditLogEvent } = require('discord.js');
const { track } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildBanRemove,
  execute(ban) {
    return track(ban.client, ban.guild, {
      rule: 'unban',
      auditLogType: AuditLogEvent.MemberBanRemove,
      targetId: ban.user.id,
      actionLabel: t(currentLanguage(), 'security.antinuke.detail.unban'),
      undo: { kind: 'reban', userId: ban.user.id },
    }).catch((err) => logger.error('Anti-nuke unban tracking failed:', err));
  },
};
