const { Events } = require('discord.js');
const reactionDb = require('../db/reactionTriggers');
const logger = require('../utils/logger');
const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.system) return;
    // Posts of announcement channels often come from other servers (followed channels) or from webhooks, which are bots: the emojis of a
    // channel go on those too, but a trigger phrase only reacts to what a person writes.
    const fromPerson = !message.author?.bot && !message.webhookId;

    try {
      const [channelEmojis, matchingTriggers] = await Promise.all([
        reactionDb.listForMessage({ guildId: message.guild.id, channelId: message.channel.id }),
        fromPerson
          ? reactionDb.listMatchingTriggers(message.guild.id, { content: message.content, channelId: message.channel.id, roleIds: message.member?.roles?.cache ? [...message.member.roles.cache.keys()] : [], userId: message.author?.id })
          : [],
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
