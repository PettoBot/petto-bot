const { Events } = require('discord.js');
const inviteTrackingDb = require('../db/inviteTracking');
const { queueFlow, queueLifespan } = require('../db/activityDetail');
const statsRules = require('../db/statsRules');
const { applyRewards } = require('../utils/inviteRewards');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (member.user?.bot) return;
    if (statsRules.allowed(member.guild.id, member.id)) {
      queueFlow(member.guild.id, { leaves: 1 });
      queueLifespan(member.guild.id, member.joinedTimestamp); // how long they stayed, as a number in a group; nobody is named
    }
    try {
      const row = await inviteTrackingDb.recordLeave(member.guild.id, member.id);
      if (row?.inviter_id && !row.fake) await applyRewards(member.guild, row.inviter_id);
    } catch (err) {
      logger.error(`Invite tracking failed for leave in guild ${member.guild.id}:`, err);
    }
  },
};
