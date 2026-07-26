const { Events } = require('discord.js');
const stickyRolesDb = require('../db/stickyRoles');
const logger = require('../utils/logger');

const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const config = await stickyRolesDb.getConfig(member.guild.id);
      if (!config?.enabled) return;

      const snapshot = await stickyRolesDb.takeSnapshot(member.guild.id, member.id);
      if (!snapshot) return;
      if (Date.now() - new Date(snapshot.left_at).getTime() > MAX_AGE_MS) return;

      const me = member.guild.members.me;
      if (!me) return;

      const assignable = snapshot.role_ids.filter((id) => {
        const role = member.guild.roles.cache.get(id);
        return role && role.position < me.roles.highest.position;
      });
      if (assignable.length === 0) return;

      await member.roles.add(assignable, 'Sticky roles: restored on rejoin').catch((err) => {
        logger.warn(`Sticky roles restore couldn't apply roles for ${member.id} in guild ${member.guild.id}:`, err.message);
      });
    } catch (err) {
      logger.error(`Sticky roles restore failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
