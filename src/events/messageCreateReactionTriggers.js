const { Events } = require('discord.js');
const reactionDb = require('../db/reactionTriggers');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author?.bot || !message.guild) return;

    try {
      const [channelEmojis, matchingTriggers] = await Promise.all([
        reactionDb.listForMessage({ guildId: message.guild.id, channelId: message.channel.id }),
        reactionDb.listMatchingTriggers(message.guild.id, message.content),
      ]);
      const emojis = [...new Set([...channelEmojis, ...matchingTriggers.map((row) => row.emoji)])];
      for (const emoji of emojis) await message.react(emoji).catch(() => {});
    } catch (err) {
      logger.error('Reaction message automation failed:', err);
    }
  },
};
