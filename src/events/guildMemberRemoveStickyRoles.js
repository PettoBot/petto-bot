const { Events } = require('discord.js');
const stickyRolesDb = require('../db/stickyRoles');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    try {
      const config = await stickyRolesDb.getConfig(member.guild.id);
      if (!config?.enabled) return;

      const roleIds = member.roles.cache
        .filter((r) => r.id !== member.guild.id && !r.managed)
        .map((r) => r.id);

      await stickyRolesDb.saveSnapshot(member.guild.id, member.id, roleIds);
    } catch (err) {
      logger.error(`Sticky roles snapshot failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
