const { Events } = require('discord.js');
const { handleMessagePublished } = require('../logging/moreLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageUpdate,
  execute(...args) {
    const run = (oldMessage, newMessage, client) => handleMessagePublished(oldMessage, newMessage, client);
    return run(...args).catch((err) => logger.error('[messageUpdatePublishLog]', err));
  },
};
