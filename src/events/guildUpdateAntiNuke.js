const { Events, AuditLogEvent } = require('discord.js');
const { track } = require('../utils/antiNuke');
const logger = require('../utils/logger');

// The name, the icon or the vanity code changed: whoever keeps changing them is watched by the protection.
module.exports = {
  name: Events.GuildUpdate,
  execute(oldGuild, newGuild) {
    const changed = [];
    if (oldGuild.name !== newGuild.name) changed.push('name');
    if (oldGuild.icon !== newGuild.icon) changed.push('icon');
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) changed.push('vanity');
    if (!changed.length) return;
    return track(newGuild.client, newGuild, {
      rule: 'guild_update',
      auditLogType: AuditLogEvent.GuildUpdate,
      byRecency: true,
      actionLabel: `server ${changed.join(' and ')} changed`,
    }).catch((err) => logger.error('Anti-nuke server-change tracking failed:', err));
  },
};
