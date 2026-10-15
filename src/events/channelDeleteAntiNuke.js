const { Events, AuditLogEvent } = require('discord.js');
const { trackDestructiveAction } = require('../utils/antiNuke');
const { snapshotChannel } = require('../utils/antiNukeRestore');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.ChannelDelete,
  execute(channel) {
    if (!channel.guild) return;
    return trackDestructiveAction(channel.client, channel.guild, { rule: 'channel_delete', auditLogType: AuditLogEvent.ChannelDelete, targetId: channel.id, actionLabel: t(currentLanguage(), 'security.antinuke.detail.channelDelete'), undo: snapshotChannel(channel) }).catch((err) =>
      logger.error('Anti-nuke channel-delete tracking failed:', err),
    );
  },
};
