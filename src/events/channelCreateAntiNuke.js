const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelCreate,
  execute(channel) {
    if (!channel.guild) return;
    return trackDestructiveAction(channel.client, channel.guild, {
      auditLogType: AuditLogEvent.ChannelCreate,
      targetId: channel.id,
      actionLabel: 'channel creation',
    }).catch((err) => logger.error('Anti-nuke channel-create tracking failed:', err));
  },
};
