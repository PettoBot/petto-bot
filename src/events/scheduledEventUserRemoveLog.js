const { Events } = require('discord.js');
const { handleEventInterest } = require('../logging/moreLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildScheduledEventUserRemove,
  execute(...args) {
    const run = (event, user, client) => handleEventInterest('unsubscribed', event, user, client);
    return run(...args).catch((err) => logger.error('[scheduledEventUserRemoveLog]', err));
  },
};
