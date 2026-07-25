const { Events } = require('discord.js');
const inviteCache = require('../utils/inviteCache');
const inviteTrackingDb = require('../db/inviteTracking');
const { ensureGuild } = require('../db/guilds');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const guild = member.guild;

    if (!guild.members.me.permissions.has('ManageGuild')) return; // can't fetch invite uses without it

    try {
      const before = inviteCache.getGuildCache(guild.id) ?? new Map();
      const afterInvites = await guild.invites.fetch().catch(() => null);
      if (!afterInvites) return;

      let usedInvite = null;
      for (const invite of afterInvites.values()) {
        const prev = before.get(invite.code);
        if (!prev || (invite.uses ?? 0) > prev.uses) {
          usedInvite = invite;
          break;
        }
      }

      inviteCache.replaceGuildCache(guild.id, afterInvites);
      await ensureGuild(guild.id);
      await inviteTrackingDb.recordJoin(guild.id, member.id, usedInvite?.inviter?.id ?? null, usedInvite?.code ?? null);
    } catch (err) {
      logger.error(`Invite tracking failed for join in guild ${guild.id}:`, err);
    }
  },
};
