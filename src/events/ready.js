const { Events, ActivityType } = require('discord.js');
const { warmGuild } = require('../utils/inviteCache');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    client.user.setPresence({
      status: 'online',
      activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: 'Keeping the server safe', emoji: { name: '🦆' } }],
    });

    logger.info(`Petto is online as ${client.user.tag}, serving ${client.guilds.cache.size} guild(s).`);

    // Warms the invite-tracking cache for every guild so the first join after startup can already
    // be attributed correctly, instead of only starting to work after the first InviteCreate/Delete.
    for (const guild of client.guilds.cache.values()) {
      await warmGuild(guild);
    }
  },
};
