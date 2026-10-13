const { Events } = require('discord.js');
const starboardDb = require('../db/starboard');
const logger = require('../utils/logger');
const { syncBoard, buildCustomPayload } = require('../utils/reactionBoard');

const board = { db: starboardDb };

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot) return;
    await syncBoard(reaction, board).catch((err) => logger.error('Starboard reaction sync failed:', err));
  },
};

module.exports.syncStarboard = (reaction) => syncBoard(reaction, board);
module.exports.buildCustomPayload = buildCustomPayload;
