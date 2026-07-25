const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelDelete,
  execute(channel) {
    if (!channel.guild) return;
    return trackDestructiveAction(channel.client, channel.guild, { auditLogType: AuditLogEvent.ChannelDelete, targetId: channel.id, actionLabel: 'channel deletion' }).catch((err) =>
      logger.error('Anti-nuke channel-delete tracking failed:', err),
    );
  },
};
