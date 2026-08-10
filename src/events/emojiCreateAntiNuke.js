const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildEmojiCreate,
  execute(emoji) {
    return trackDestructiveAction(emoji.client, emoji.guild, {
      auditLogType: AuditLogEvent.EmojiCreate,
      targetId: emoji.id,
      actionLabel: 'emoji creation',
    }).catch((err) => logger.error('Anti-nuke emoji-create tracking failed:', err));
  },
};
