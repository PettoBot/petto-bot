const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildEmojiDelete,
  execute(emoji) {
    if (!emoji.guild) return;
    return trackDestructiveAction(emoji.client, emoji.guild, { rule: 'emoji_delete', auditLogType: AuditLogEvent.EmojiDelete, targetId: emoji.id, actionLabel: t(currentLanguage(), 'security.antinuke.detail.emojiDelete') }).catch((err) =>
      logger.error('Anti-nuke emoji-deletion tracking failed:', err),
    );
  },
};
