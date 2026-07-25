const { Events } = require('discord.js');
const { incrementActivity } = require('../db/activityStats');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot || !reaction.message.guild) return;

    try {
      if (reaction.partial) await reaction.fetch().catch(() => null);
      await incrementActivity(reaction.message.guild.id, reaction.message.channelId, { reactions: 1 });
    } catch (err) {
      logger.error('Activity stats reaction increment failed:', err);
    }
  },
};
