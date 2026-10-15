const { Events, PermissionFlagsBits } = require('discord.js');
const joinRolesDb = require('../db/joinRoles');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const guild = member.guild;
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) return;

    try {
      const configured = await joinRolesDb.listRoles(guild.id);
      if (!configured.length) return;

      const wanted = configured.filter((jr) => {
        if (jr.target === 'all') return true;
        return jr.target === 'bots' ? member.user.bot : !member.user.bot;
      });
      const roles = wanted.map((jr) => guild.roles.cache.get(jr.role_id)).filter((r) => r && r.position < guild.members.me.roles.highest.position && !r.managed);
      if (!roles.length) return;

      await member.roles.add(roles, t(currentLanguage(), 'welcome.joinRole.auditReason')).catch((err) => logger.warn(`Join role assignment failed for ${member.id} in guild ${guild.id}:`, err.message));
    } catch (err) {
      logger.error(`Join role handling failed for ${member.id} in guild ${guild.id}:`, err);
    }
  },
};
