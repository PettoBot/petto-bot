const { Events } = require('discord.js');
const { handleEventInterest } = require('../logging/moreLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildScheduledEventUserAdd,
  execute(...args) {
    const run = (event, user, client) => handleEventInterest('subscribed', event, user, client);
    return run(...args).catch((err) => logger.error('[scheduledEventUserAddLog]', err));
  },
};
