const { Events } = require('discord.js');
const { handleMessageDelete } = require('../logging/messageLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageDelete,
  execute(message, client) {
    return handleMessageDelete(message, client).catch((err) => logger.error('[messageDelete]', err));
  },
};
