const { Events } = require('discord.js');
const { enforceJail } = require('../utils/jailGuard');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    try {
      await enforceJail(oldMember, newMember);
    } catch (err) {
      logger.error(`Jail guard failed for ${newMember.id} in guild ${newMember.guild.id}:`, err);
    }
  },
};
