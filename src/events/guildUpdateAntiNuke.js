const { Events, AuditLogEvent } = require('discord.js');
const { track } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

// The name, the icon or the vanity code changed: whoever keeps changing them is watched by the protection.
module.exports = {
  name: Events.GuildUpdate,
  execute(oldGuild, newGuild) {
    const lang = currentLanguage();
    const changed = [];
    if (oldGuild.name !== newGuild.name) changed.push(t(lang, 'security.antinuke.detail.changed.name'));
    if (oldGuild.icon !== newGuild.icon) changed.push(t(lang, 'security.antinuke.detail.changed.icon'));
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) changed.push(t(lang, 'security.antinuke.detail.changed.vanity'));
    if (!changed.length) return;
    return track(newGuild.client, newGuild, {
      rule: 'guild_update',
      auditLogType: AuditLogEvent.GuildUpdate,
      byRecency: true,
      actionLabel: t(lang, 'security.antinuke.detail.guildUpdate', { what: changed.join(` ${t(lang, 'common.and')} `) }),
    }).catch((err) => logger.error('Anti-nuke server-change tracking failed:', err));
  },
};
