const { Events, AuditLogEvent } = require('discord.js');
const { track } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, tn, currentLanguage } = require('../i18n');

// A prune removes many members in one go and the audit log says who did it, so it is read from the entry itself.
module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  async execute(entry, guild) {
    if (!guild || entry?.action !== AuditLogEvent.MemberPrune) return;
    try {
      const executor = entry.executor ?? (entry.executorId ? await guild.client.users.fetch(entry.executorId).catch(() => null) : null);
      if (!executor) return;
      const removed = Number(entry.extra?.removed ?? entry.extra?.membersRemoved ?? 0);
      const lang = currentLanguage();
      await track(guild.client, guild, {
        rule: 'prune',
        executor,
        actionLabel: removed ? tn(lang, 'security.antinuke.detail.pruneCount', removed, { count: removed }) : t(lang, 'security.antinuke.detail.prune'),
      });
    } catch (err) {
      logger.error('Anti-nuke prune tracking failed:', err);
    }
  },
};
