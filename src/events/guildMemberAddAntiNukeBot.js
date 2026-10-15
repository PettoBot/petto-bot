const { Events, AuditLogEvent } = require('discord.js');
const { track } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

// A bot joins: the audit log says who added it. With the protection on, the bot is removed and the account that added it answers.
module.exports = {
  name: Events.GuildMemberAdd,
  execute(member) {
    if (!member.user.bot) return;
    return track(member.client, member.guild, {
      rule: 'bot_add',
      auditLogType: AuditLogEvent.BotAdd,
      targetId: member.id,
      actionLabel: t(currentLanguage(), 'security.antinuke.detail.botAdd', { name: member.user.username }),
      inline: [{ kind: 'kick_bot', id: member.id }],
    }).catch((err) => logger.error('Anti-nuke bot-add tracking failed:', err));
  },
};
