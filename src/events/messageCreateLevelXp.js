const { Events } = require('discord.js');
const { getConfig } = require('../db/levelConfig');
const { getMultiplier, grantXp } = require('../utils/levelActions');
const logger = require('../utils/logger');

const COOLDOWN_MS_PER_SECOND = 1000;
const cooldowns = new Map(); // `${guildId}:${userId}` -> last XP grant timestamp

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.guild || !message.member) return;

    try {
      const config = await getConfig(message.guild.id);
      if (!config?.enabled) return;
      if (config.ignored_channel_ids.includes(message.channel.id)) return;

      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const last = cooldowns.get(key) ?? 0;
      if (now - last < config.cooldown_seconds * COOLDOWN_MS_PER_SECOND) return;
      cooldowns.set(key, now);

      const multi = await getMultiplier(message.guild.id, message.channel.id, message.member);
      const base = Math.floor(Math.random() * (config.xp_max - config.xp_min + 1)) + config.xp_min;
      const xpGain = Math.round(base * multi);

      await grantXp({ client: message.client, guild: message.guild, member: message.member, config, xpGain, messageInc: 1, channel: message.channel });
    } catch (err) {
      logger.error(`Level XP grant failed for message ${message.id}:`, err);
    }
  },
};
