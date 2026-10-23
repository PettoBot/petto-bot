const { Events } = require('discord.js');
const { syncClownboard } = require('./clownboardReaction');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction) {
    await syncClownboard(reaction).catch((err) => logger.error('Clownboard reaction removal sync failed:', err));
  },
};
