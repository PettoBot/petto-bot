const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.ChannelCreate,
  execute(channel) {
    if (!channel.guild) return;
    return trackDestructiveAction(channel.client, channel.guild, {
      auditLogType: AuditLogEvent.ChannelCreate,
      targetId: channel.id,
      rule: 'channel_create',
      actionLabel: t(currentLanguage(), 'security.antinuke.detail.channelCreate'),
      undo: { kind: 'delete_channel', id: channel.id },
    }).catch((err) => logger.error('Anti-nuke channel-create tracking failed:', err));
  },
};
