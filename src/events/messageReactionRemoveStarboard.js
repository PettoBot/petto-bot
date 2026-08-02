const { Events } = require('discord.js');
const { syncStarboard } = require('./starboardReaction');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction) {
    await syncStarboard(reaction).catch((err) => logger.error('Starboard reaction removal sync failed:', err));
  },
};
