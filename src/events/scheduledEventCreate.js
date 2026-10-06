const { Events } = require('discord.js');
const { handleScheduledEventCreate } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildScheduledEventCreate,
  execute(event, client) {
    return handleScheduledEventCreate(event, client).catch((err) => logger.error('[scheduledEventCreate]', err));
  },
};
