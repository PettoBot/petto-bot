const { Events } = require('discord.js');
const { warmGuild } = require('../utils/inviteCache');

// A server Petto is added to after it started has no snapshot of its invites: one request now (never the same moment as the start,
// where the ready event reads them all), so the first join can already tell which invite was used.
module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    if (!guild.client?.isReady?.()) return;
    await warmGuild(guild);
  },
};
