const { Events } = require('discord.js');
const { queueActivity } = require('../db/activityStats');
const statsRules = require('../db/statsRules');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    if (user.bot || !reaction.message.guild) return;
    if (!statsRules.allowed(reaction.message.guild.id, user.id)) return;

    try {
      if (reaction.partial) await reaction.fetch().catch(() => null);
      queueActivity(reaction.message.guild.id, reaction.message.channelId, { reactions: 1 });
    } catch (err) {
      logger.error('Activity stats reaction increment failed:', err);
    }
  },
};
