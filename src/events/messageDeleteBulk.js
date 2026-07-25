const { Events } = require('discord.js');
const { handleMessageBulkDelete } = require('../logging/messageLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageBulkDelete,
  execute(messages, channel, client) {
    return handleMessageBulkDelete(messages, channel, client).catch((err) => logger.error('[messageDeleteBulk]', err));
  },
};
