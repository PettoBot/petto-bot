const { Events } = require('discord.js');
const { handleInvitePosted } = require('../logging/moreLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  execute(...args) {
    const run = (message, client) => handleInvitePosted(message, client);
    return run(...args).catch((err) => logger.error('[messageCreateInviteLog]', err));
  },
};
