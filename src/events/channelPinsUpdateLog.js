const { Events } = require('discord.js');
const { handleChannelPins } = require('../logging/extraLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelPinsUpdate,
  execute(channel, client) {
    return handleChannelPins(channel, client).catch((err) => logger.error('[channelPinsUpdateLog]', err));
  },
};
