const { Events } = require('discord.js');
const inviteTrackingDb = require('../db/inviteTracking');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    try {
      await inviteTrackingDb.recordLeave(member.guild.id, member.id);
    } catch (err) {
      logger.error(`Invite tracking failed for leave in guild ${member.guild.id}:`, err);
    }
  },
};
