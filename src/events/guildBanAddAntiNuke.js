const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildBanAdd,
  execute(ban) {
    return trackDestructiveAction(ban.client, ban.guild, { rule: 'ban', auditLogType: AuditLogEvent.MemberBanAdd, targetId: ban.user.id, actionLabel: t(currentLanguage(), 'security.antinuke.detail.ban'), undo: { kind: 'unban', userId: ban.user.id } }).catch((err) =>
      logger.error('Anti-nuke ban tracking failed:', err),
    );
  },
};
