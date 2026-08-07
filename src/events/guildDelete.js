const { Events } = require('discord.js');
const { sendGuildLifecycleLog } = require('../utils/discordOps');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildDelete,
  async execute(guild) {
    try {
      // Discord emits the same event when the owner removes the bot or when Petto
      // leaves by code, so the log deliberately describes both possibilities.
      await sendGuildLifecycleLog(guild.client, {
        kind: 'leave',
        guild,
        ownerId: guild.ownerId ?? null,
      });
    } catch (err) {
      logger.error(`guildDelete leave notification failed for guild ${guild.id}:`, err);
    }
  },
};
