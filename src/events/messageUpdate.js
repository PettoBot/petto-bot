const { Events } = require('discord.js');
const { handleMessageUpdate } = require('../logging/messageLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageUpdate,
  execute(oldMessage, newMessage, client) {
    return handleMessageUpdate(oldMessage, newMessage, client).catch((err) => logger.error('[messageUpdate]', err));
  },
};
