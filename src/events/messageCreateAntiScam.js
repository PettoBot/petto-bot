const { Events } = require('discord.js');
const { handleMessage } = require('../utils/antiScam');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      await handleMessage(message);
    } catch (err) {
      logger.error(`Anti scam failed for message ${message.id}:`, err);
    }
  },
};
