const { Events } = require('discord.js');
const { clearHoneypotUser } = require('../db/honeypot');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    try {
      // A claim is an active-membership guard. If a kicked/banned member later
      // rejoins, the Honeypot should be able to catch that new visit once.
      await clearHoneypotUser(member.guild.id, member.id);
    } catch (err) {
      logger.warn(`Honeypot claim cleanup failed for ${member.id} in ${member.guild.id}:`, err.message);
    }
  },
};
