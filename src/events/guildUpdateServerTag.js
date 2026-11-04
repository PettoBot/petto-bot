const { Events } = require('discord.js');
const { serverTagsAvailable } = require('../utils/identity/service');
const { recheckServerTag } = require('../utils/identity/serverTagWatch');

// The server gained or lost the improvement that allows a Server Tag (its boosts went up or down): everybody is checked again, so the roles given for showing the tag
// go away when it is lost (nothing else would tell Petto) and come back when it returns.
module.exports = {
  name: Events.GuildUpdate,
  async execute(oldGuild, newGuild) {
    if (!oldGuild || !newGuild) return;
    if (serverTagsAvailable(oldGuild) === serverTagsAvailable(newGuild)) return;
    await recheckServerTag(newGuild, 'improvements-changed');
  },
};
