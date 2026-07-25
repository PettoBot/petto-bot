const { Events } = require('discord.js');
const { handleBumpMessage, handleBumpAutoclean } = require('../utils/bumpHandler');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      await handleBumpMessage(message);
      await handleBumpAutoclean(message);
    } catch (err) {
      logger.error('Bump message handling failed:', err);
    }
  },
};
