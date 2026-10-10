const { Events } = require('discord.js');
const { resolveJoinInvite, wasVanityJoin } = require('../utils/inviteResolve');
const inviteTrackingDb = require('../db/inviteTracking');
const { queueFlow } = require('../db/activityDetail');
const { ensureGuild } = require('../db/guilds');
const { applyRewards } = require('../utils/inviteRewards');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const guild = member.guild;
    if (member.user.bot) return;
    queueFlow(guild.id, { joins: 1 });
    if (!guild.members.me.permissions.has('ManageGuild')) return; // can't fetch invite uses without it

    try {
      const usedInvite = await resolveJoinInvite(member);
      const vanity = usedInvite ? false : await wasVanityJoin(guild);
      await ensureGuild(guild.id);
      const result = await inviteTrackingDb.recordJoin(guild.id, member.id, usedInvite?.inviter?.id ?? null, usedInvite?.code ?? null, {
        accountCreatedAt: member.user.createdTimestamp,
        source: vanity ? 'vanity' : null,
      });
      if (usedInvite?.inviter?.id && !result.fake) {
        queueFlow(guild.id, { invited: 1 });
        await applyRewards(guild, usedInvite.inviter.id);
      }
    } catch (err) {
      logger.error(`Invite tracking failed for join in guild ${guild.id}:`, err);
    }
  },
};
