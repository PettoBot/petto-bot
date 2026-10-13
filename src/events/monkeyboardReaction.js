const { Events } = require('discord.js');
const monkeyboardDb = require('../db/monkeyboard');
const logger = require('../utils/logger');
const { syncBoard } = require('../utils/reactionBoard');

const board = { db: monkeyboardDb, variable: 'monkey' };

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;
    await syncBoard(reaction, board).catch((err) => logger.error('Monkeyboard reaction sync failed:', err));
  },
};

module.exports.syncMonkeyboard = (reaction) => syncBoard(reaction, board);
