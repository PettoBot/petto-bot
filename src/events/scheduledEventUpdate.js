const { Events } = require('discord.js');
const { handleScheduledEventUpdate } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildScheduledEventUpdate,
  execute(oldEvent, newEvent, client) {
    return handleScheduledEventUpdate(oldEvent, newEvent, client).catch((err) => logger.error('[scheduledEventUpdate]', err));
  },
};
