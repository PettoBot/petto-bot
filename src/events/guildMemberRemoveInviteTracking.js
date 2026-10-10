const { Events } = require('discord.js');
const inviteTrackingDb = require('../db/inviteTracking');
const { queueFlow } = require('../db/activityDetail');
const { applyRewards } = require('../utils/inviteRewards');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (member.user?.bot) return;
    queueFlow(member.guild.id, { leaves: 1 });
    try {
      const row = await inviteTrackingDb.recordLeave(member.guild.id, member.id);
      if (row?.inviter_id && !row.fake) await applyRewards(member.guild, row.inviter_id);
    } catch (err) {
      logger.error(`Invite tracking failed for leave in guild ${member.guild.id}:`, err);
    }
  },
};
