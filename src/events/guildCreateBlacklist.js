// A blacklisted server added Petto: leave at once (utils/guildBlacklist.js). The loader of events (handlers/eventHandler.js) does not run any other listener of
// guildCreate for a blacklisted server, so nothing is written, no message is sent and no invite is read before this has run: this listener is the only one.
const { Events } = require('discord.js');
const { handleJoin } = require('../utils/guildBlacklist');

module.exports = {
  name: Events.GuildCreate,
  blacklistExempt: true,
  async execute(guild, client) {
    await handleJoin(client ?? guild.client, guild);
  },
};
