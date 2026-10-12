const { Events } = require('discord.js');
const { getConfig } = require('../db/levelConfig');
const levelUsersDb = require('../db/levelUsers');
const { syncRewardRoles } = require('../utils/levelActions');
const logger = require('../utils/logger');

// A member who returns gets back the reward roles their levels earned (unless the server turned it off).
module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user?.bot) return;
    try {
      const config = await getConfig(member.guild.id);
      if (!config?.enabled || config.restore_roles === false) return;
      const row = await levelUsersDb.getUser(member.guild.id, member.id);
      if (row) await syncRewardRoles(member.guild, member, row, config);
    } catch (error) {
      logger.warn({ guildId: member.guild.id, action: 'level-restore-roles' }, `The reward roles of a returning member could not be restored: ${error.message}`);
    }
  },
};
