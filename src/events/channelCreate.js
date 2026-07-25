const { Events } = require('discord.js');
const { handleChannelCreate } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelCreate,
  execute(channel, client) {
    return handleChannelCreate(channel, client).catch((err) => logger.error('[channelCreate]', err));
  },
};
