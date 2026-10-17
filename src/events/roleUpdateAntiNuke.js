const { Events, AuditLogEvent } = require('discord.js');
const { track } = require('../utils/antiNuke');
const { DANGEROUS_ROLE_FLAGS, gainedFlags } = require('../utils/antiNukeDanger');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

// A role edited (name, permissions, color...). Editing roles in a row is counted; giving a role (or @everyone) a dangerous
// permission answers at once. Either way, when the protection answers the roles go back to how they were.
module.exports = {
  name: Events.GuildRoleUpdate,
  execute(oldRole, newRole) {
    if (!newRole.guild) return;
    const permissionsChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield;
    const changed = permissionsChanged || oldRole.name !== newRole.name || oldRole.color !== newRole.color || oldRole.hoist !== newRole.hoist || oldRole.mentionable !== newRole.mentionable;
    if (!changed) return;
    const gained = permissionsChanged ? gainedFlags(oldRole.permissions.bitfield, newRole.permissions.bitfield, DANGEROUS_ROLE_FLAGS) : [];
    const lang = currentLanguage();
    const name = newRole.id === newRole.guild.id ? '@everyone' : newRole.name;
    return track(newRole.client, newRole.guild, {
      rule: 'role_update',
      auditLogType: AuditLogEvent.RoleUpdate,
      targetId: newRole.id,
      immediate: gained.length > 0,
      actionLabel: gained.length
        ? t(lang, 'security.antinuke.detail.roleEscalation', { role: name, permissions: gained.join(', ') })
        : t(lang, 'security.antinuke.detail.roleUpdate', { role: name }),
      inline: [{ kind: 'revert_role', id: oldRole.id, name: oldRole.name, permissions: oldRole.permissions.bitfield.toString(), color: oldRole.color, hoist: Boolean(oldRole.hoist), mentionable: Boolean(oldRole.mentionable) }],
    }).catch((err) => logger.error('Anti-nuke role-update tracking failed:', err));
  },
};
