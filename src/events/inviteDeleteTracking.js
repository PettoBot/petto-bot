const { Events } = require('discord.js');
const inviteCache = require('../utils/inviteCache');

module.exports = {
  name: Events.InviteDelete,
  async execute(invite) {
    if (!invite.guild) return;
    inviteCache.deleteInvite(invite.guild.id, invite.code);
  },
};
