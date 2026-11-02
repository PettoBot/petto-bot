const { Events } = require('discord.js');
const { sendGuildLifecycleLog } = require('../utils/discordOps');
const logger = require('../utils/logger');
const { forgetGuildLanguage } = require('../i18n');
const guildDepartures = require('../db/guildDepartures');
const guildBlacklist = require('../db/guildBlacklist');

module.exports = {
  name: Events.GuildDelete,
  // It must run for a blacklisted server too: the data Petto kept for it is handled as for any server that is gone (the departure is written down).
  blacklistExempt: true,
  async execute(guild) {
    forgetGuildLanguage(guild.id);
    // A server that is only unavailable (an outage of Discord) has not removed Petto: the date is written down only when it really left.
    if (guild.available !== false) await guildDepartures.mark(guild.id).catch((err) => logger.warn(`Could not write down that Petto left server ${guild.id}: ${err.message}`));
    // A blacklisted server has its own notes in the team channel (utils/guildBlacklist.js, limited): a loop of "add Petto and be removed" must not post here each time.
    if (guildBlacklist.isBlacklisted(guild.id)) return;
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
