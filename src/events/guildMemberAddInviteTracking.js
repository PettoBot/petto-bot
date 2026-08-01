const { Events } = require('discord.js');
const { resolveJoinInvite } = require('../utils/inviteResolve');
const inviteTrackingDb = require('../db/inviteTracking');
const { ensureGuild } = require('../db/guilds');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const guild = member.guild;
    if (!guild.members.me.permissions.has('ManageGuild')) return; // can't fetch invite uses without it

    try {
      const usedInvite = await resolveJoinInvite(member);
      await ensureGuild(guild.id);
      await inviteTrackingDb.recordJoin(guild.id, member.id, usedInvite?.inviter?.id ?? null, usedInvite?.code ?? null);
    } catch (err) {
      logger.error(`Invite tracking failed for join in guild ${guild.id}:`, err);
    }
  },
};
