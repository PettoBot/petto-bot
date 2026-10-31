const { Events } = require('discord.js');
const { resolveJoinInvite, wasVanityJoin } = require('../utils/inviteResolve');
const inviteTrackingDb = require('../db/inviteTracking');
const { queueFlow } = require('../db/activityDetail');
const statsRules = require('../db/statsRules');
const { ensureGuild } = require('../db/guilds');
const { applyRewards } = require('../utils/inviteRewards');
const logger = require('../utils/logger');

/** A bot account never uses an invite, so it is only written down (source `bot`, nobody credited, no request to Discord) in a server that chose to ignore bots. */
async function recordBot(member) {
  const guild = member.guild;
  try {
    if (!(await inviteTrackingDb.getSettings(guild.id)).ignoreBots) return;
    await ensureGuild(guild.id);
    await inviteTrackingDb.recordJoin(guild.id, member.id, null, null, { accountCreatedAt: member.user.createdTimestamp, source: 'bot' });
  } catch (err) {
    logger.error(`Invite tracking failed for a bot join in guild ${guild.id}:`, err);
  }
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const guild = member.guild;
    if (member.user.bot) return recordBot(member);
    const counted = Boolean(statsRules.allowed(guild.id, member.id));
    if (counted) queueFlow(guild.id, { joins: 1 });
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
        if (counted) queueFlow(guild.id, { invited: 1 });
        await applyRewards(guild, usedInvite.inviter.id);
      }
    } catch (err) {
      logger.error(`Invite tracking failed for join in guild ${guild.id}:`, err);
    }
  },
};
