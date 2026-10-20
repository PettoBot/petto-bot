// A channel is deleted: the paginated messages it had go with it.
const { Events } = require('discord.js');
const { messageIdsOf, deleteByChannel } = require('../db/paginations');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    try {
      if (!channel?.guildId) return;
      // Most servers have no paginated message: the cached list answers without a write.
      if (!(await messageIdsOf(channel.guildId)).size) return;
      await deleteByChannel(channel.guildId, channel.id);
    } catch (error) {
      logger.warn(`[pagination] could not forget the messages of a deleted channel: ${error?.message ?? error}`);
    }
  },
};
