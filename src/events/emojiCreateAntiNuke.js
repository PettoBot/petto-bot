const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildEmojiCreate,
  execute(emoji) {
    return trackDestructiveAction(emoji.client, emoji.guild, {
      rule: 'emoji_create',
      auditLogType: AuditLogEvent.EmojiCreate,
      targetId: emoji.id,
      actionLabel: t(currentLanguage(), 'security.antinuke.detail.emojiCreate'),
    }).catch((err) => logger.error('Anti-nuke emoji-create tracking failed:', err));
  },
};
