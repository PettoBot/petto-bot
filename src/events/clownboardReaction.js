const { Events } = require('discord.js');
const clownboardDb = require('../db/clownboard');
const logger = require('../utils/logger');
const { syncBoard } = require('../utils/reactionBoard');

const board = { db: clownboardDb, variable: 'clown' };

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;
    await syncBoard(reaction, board).catch((err) => logger.error('Clownboard reaction sync failed:', err));
  },
};

module.exports.syncClownboard = (reaction) => syncBoard(reaction, board);
