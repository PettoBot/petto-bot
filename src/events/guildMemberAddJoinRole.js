const { Events, PermissionFlagsBits } = require('discord.js');
const joinRolesDb = require('../db/joinRoles');
const { addRoles, isGone, reportDeadRoles } = require('../utils/deadRoles');
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
      // A role that was deleted from the server is not given, and the others still are; the staff is told about it (utils/deadRoles.js).
      const gone = wanted.filter((jr) => isGone(guild, jr.role_id)).map((jr) => jr.role_id);
      const roles = wanted.map((jr) => guild.roles.cache.get(jr.role_id)).filter((r) => r && r.position < guild.members.me.roles.highest.position && !r.managed);
      const result = await addRoles(member, roles, t(currentLanguage(), 'welcome.joinRole.auditReason'));
      if (result.error) logger.warn(`Join role assignment failed for ${member.id} in guild ${guild.id}:`, result.error.message);
      gone.push(...result.dead);
      if (gone.length) await reportDeadRoles({ client: member.client, guild, kind: 'join', roleIds: gone, forget: (roleId) => joinRolesDb.removeRole(guild.id, roleId) });
    } catch (err) {
      logger.error(`Join role handling failed for ${member.id} in guild ${guild.id}:`, err);
    }
  },
};
