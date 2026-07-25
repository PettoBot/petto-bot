const { Events } = require('discord.js');
const { handleChannelUpdate } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelUpdate,
  execute(oldChannel, newChannel, client) {
    return handleChannelUpdate(oldChannel, newChannel, client).catch((err) => logger.error('[channelUpdate]', err));
  },
};
