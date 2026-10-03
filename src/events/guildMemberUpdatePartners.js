// When the Partner Manager role is given to a member, they are welcomed in the welcome channel of the server (if it has one).
const { Events } = require('discord.js');
const partnersDb = require('../db/partners');
const { sendManagerWelcome } = require('../utils/partnerWelcome');
const logger = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    try {
      if (!newMember.guild || newMember.user?.bot || oldMember.partial) return;
      const config = await partnersDb.getConfigCached(newMember.guild.id);
      if (!config?.enabled || !config.manager_role_id || !config.welcome_channel_id) return;
      const had = oldMember.roles.cache.has(config.manager_role_id);
      const has = newMember.roles.cache.has(config.manager_role_id);
      if (had || !has) return;
      await sendManagerWelcome({ guild: newMember.guild, member: newMember, config });
    } catch (error) {
      logger.error(`Partner Manager welcome failed in guild ${newMember.guild?.id}:`, error);
    }
  },
};
