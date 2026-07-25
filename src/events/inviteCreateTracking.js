const { Events } = require('discord.js');
const inviteCache = require('../utils/inviteCache');

module.exports = {
  name: Events.InviteCreate,
  async execute(invite) {
    if (!invite.guild) return;
    inviteCache.setInvite(invite.guild.id, invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
  },
};
