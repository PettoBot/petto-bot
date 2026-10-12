const { Events } = require('discord.js');
const { getConfig } = require('../db/levelConfig');
const levelUsersDb = require('../db/levelUsers');
const logger = require('../utils/logger');

// A member who leaves keeps their XP, unless the server chose (`!level rules reset_on_leave on`) to wipe it.
module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (member.user?.bot) return;
    try {
      const config = await getConfig(member.guild.id);
      if (config?.reset_on_leave) await levelUsersDb.resetUser(member.guild.id, member.id);
    } catch (error) {
      logger.warn({ guildId: member.guild.id, action: 'level-reset-on-leave' }, `The level of a member who left could not be wiped: ${error.message}`);
    }
  },
};
