const { Events, AuditLogEvent } = require('discord.js');
const { track } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

// The name, the icon or the vanity code changed: whoever keeps changing them is watched by the protection, and the name
// and the icon are put back when it answers.
module.exports = {
  name: Events.GuildUpdate,
  execute(oldGuild, newGuild) {
    const lang = currentLanguage();
    const changed = [];
    if (oldGuild.name !== newGuild.name) changed.push(t(lang, 'security.antinuke.detail.changed.name'));
    if (oldGuild.icon !== newGuild.icon) changed.push(t(lang, 'security.antinuke.detail.changed.icon'));
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) changed.push(t(lang, 'security.antinuke.detail.changed.vanity'));
    if (!changed.length) return;
    // When the protection answers, the name and the icon go back to how they were (a bot cannot set the vanity back: the alert says it).
    const revert = { kind: 'revert_guild' };
    if (oldGuild.name !== newGuild.name) revert.name = oldGuild.name;
    if (oldGuild.icon !== newGuild.icon) revert.iconUrl = oldGuild.icon ? oldGuild.iconURL({ extension: oldGuild.icon.startsWith('a_') ? 'gif' : 'png', size: 1024 }) : null;
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode && oldGuild.vanityURLCode) revert.vanity = oldGuild.vanityURLCode;
    return track(newGuild.client, newGuild, {
      rule: 'guild_update',
      auditLogType: AuditLogEvent.GuildUpdate,
      targetId: newGuild.id,
      actionLabel: t(lang, 'security.antinuke.detail.guildUpdate', { what: changed.join(` ${t(lang, 'common.and')} `) }),
      inline: [revert],
    }).catch((err) => logger.error('Anti-nuke server-change tracking failed:', err));
  },
};
