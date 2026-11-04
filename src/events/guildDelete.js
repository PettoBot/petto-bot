const { Events } = require('discord.js');
const { sendGuildLifecycleLog } = require('../utils/discordOps');
const logger = require('../utils/logger');
const { forgetGuildLanguage } = require('../i18n');
const guildDepartures = require('../db/guildDepartures');
const guildBlacklist = require('../db/guildBlacklist');
const guildGone = require('../utils/guildGone');

module.exports = {
  name: Events.GuildDelete,
  // It must run for a blacklisted server too: the data Petto kept for it is handled as for any server that is gone (the departure is written down).
  blacklistExempt: true,
  async execute(guild) {
    // An event for a server that was never loaded (after a restart or a reconnection) is not a departure until Discord says Petto is out: nothing is told, nothing is written down.
    // A server that is only unavailable (an outage of Discord, or a restart) has not removed Petto: it is not a departure and nothing is told about it.
    if (guild.available === false) return;
    if (guildGone.isBare(guild)) {
      const state = await guildGone.presence(guild.client, guild.id);
      if (state !== 'out') {
        logger.localWarn(`Discord reported server ${guild.id} as removed without its data (${state === 'in' ? 'Petto is still in it' : 'it could not be checked'}): no departure is logged.`);
        return;
      }
    }
    forgetGuildLanguage(guild.id);
    await guildDepartures.mark(guild.id).catch((err) => logger.warn(`Could not write down that Petto left server ${guild.id}: ${err.message}`));
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
