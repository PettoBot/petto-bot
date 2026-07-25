const { Events } = require('discord.js');
const { handleChannelDelete } = require('../logging/serverLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelDelete,
  execute(channel, client) {
    return handleChannelDelete(channel, client).catch((err) => logger.error('[channelDelete]', err));
  },
};
