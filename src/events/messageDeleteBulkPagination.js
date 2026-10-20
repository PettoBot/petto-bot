// Messages deleted at once (a purge): the paginated ones among them lose their records.
const { Events } = require('discord.js');
const { forget } = require('./messageDeletePagination');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageBulkDelete,
  async execute(messages, channel) {
    try {
      await forget(channel?.guildId ?? channel?.guild?.id, [...messages.keys()]);
    } catch (error) {
      logger.warn(`[pagination] could not forget deleted messages: ${error?.message ?? error}`);
    }
  },
};
