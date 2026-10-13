const { Events } = require('discord.js');
const { syncMonkeyboard } = require('./monkeyboardReaction');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction) {
    await syncMonkeyboard(reaction).catch((err) => logger.error('Monkeyboard reaction removal sync failed:', err));
  },
};
