const { Events } = require('discord.js');
const { handleChannelPins } = require('../logging/extraLog');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ChannelPinsUpdate,
  // Discord sends the channel and the time of the last pin; the handler adds the client after them.
  execute(channel, _lastPinAt, client) {
    return handleChannelPins(channel, client).catch((err) => logger.error('[channelPinsUpdateLog]', err));
  },
};
