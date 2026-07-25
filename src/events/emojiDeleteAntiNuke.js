const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildEmojiDelete,
  execute(emoji) {
    if (!emoji.guild) return;
    return trackDestructiveAction(emoji.client, emoji.guild, { auditLogType: AuditLogEvent.EmojiDelete, targetId: emoji.id, actionLabel: 'emoji deletion' }).catch((err) =>
      logger.error('Anti-nuke emoji-deletion tracking failed:', err),
    );
  },
};
