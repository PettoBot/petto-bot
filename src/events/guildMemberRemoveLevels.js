const { Events } = require('discord.js');
const { getConfig } = require('../db/levelConfig');
const levelUsersDb = require('../db/levelUsers');
const levelPeriodsDb = require('../db/levelPeriods');
const logger = require('../utils/logger');

// A member who leaves LOSES their XP, unless the server chose (`!level rules keep_xp on`) to keep it. Wiping deletes the row of the member (and what they earned in the
// weeks and months that are kept) instead of leaving a row of zeros, so nothing is left of them in the database or in any ranking, the public one of the website included.
module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (member.user?.bot) return;
    try {
      const config = await getConfig(member.guild.id);
      if (!config || config.keep_xp) return; // no settings row: nothing is known about the server, so nothing is deleted
      // Each one on its own: a failure in one does not leave the other behind.
      const results = await Promise.allSettled([
        levelUsersDb.deleteUser(member.guild.id, member.id),
        levelPeriodsDb.deleteUser(member.guild.id, member.id),
      ]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    } catch (error) {
      logger.warn({ guildId: member.guild.id, action: 'level-reset-on-leave' }, `The level of a member who left could not be wiped: ${error.message}`);
    }
  },
};
