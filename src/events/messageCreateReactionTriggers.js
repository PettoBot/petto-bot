const { Events } = require('discord.js');
const reactionDb = require('../db/reactionTriggers');
const logger = require('../utils/logger');
const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author?.bot || !message.guild) return;

    try {
      const [channelEmojis, matchingTriggers] = await Promise.all([
        reactionDb.listForMessage({ guildId: message.guild.id, channelId: message.channel.id }),
        reactionDb.listMatchingTriggers(message.guild.id, { content: message.content, channelId: message.channel.id, roleIds: message.member?.roles?.cache ? [...message.member.roles.cache.keys()] : [], userId: message.author.id }),
      ]);
      const now = Date.now();
      const usableTriggers = matchingTriggers.filter((row) => {
        if (!row.cooldown_seconds) return true;
        const key = `${row.id}:${message.author.id}`;
        const expiresAt = cooldowns.get(key) ?? 0;
        if (expiresAt > now) return false;
        cooldowns.set(key, now + row.cooldown_seconds * 1000);
        return true;
      });
      const emojis = [...new Set([...channelEmojis, ...usableTriggers.map((row) => row.emoji)])];
      for (const emoji of emojis) await message.react(emoji).catch(() => {});
    } catch (err) {
      logger.error('Reaction message automation failed:', err);
    }
  },
};
