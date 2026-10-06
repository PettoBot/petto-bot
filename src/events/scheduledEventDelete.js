const { Events } = require('discord.js');
const { handleScheduledEventDelete } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildScheduledEventDelete,
  execute(event, client) {
    return handleScheduledEventDelete(event, client).catch((err) => logger.error('[scheduledEventDelete]', err));
  },
};
