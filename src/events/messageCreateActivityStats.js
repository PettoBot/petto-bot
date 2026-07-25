const { Events } = require('discord.js');
const { incrementActivity } = require('../db/activityStats');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild) return;

    try {
      await incrementActivity(message.guild.id, message.channel.id, { messages: 1 });
    } catch (err) {
      logger.error(`Activity stats message increment failed for ${message.id}:`, err);
    }
  },
};
