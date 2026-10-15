const { sendLog, getAvatar } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const { COLORS } = require('./caseCard');
const { sanctionLogEmbed } = require('./sanctionTemplates');
const { typeName, reasonText, capitalize } = require('./caseFormat');
const { t, guildLanguage } = require('../i18n');

/**
 * Logs a single moderation case to the 'sanctions' category of the /logs system
 * (per-channel webhooks, same as messages/members/roles/etc). This is the only
 * place sanction actions get logged — there's no separate mod-log channel setting.
 * The entry is written in the server's language, whoever applied the sanction (a command, a job, the dashboard).
 */
async function logSanction(client, guild, { modCase, target, moderator, reason, duration, source = 'moderator' }) {
  const lang = await guildLanguage(guild.id);
  const permanent = ['ban', 'hardban', 'mute', 'jail'].includes(modCase.type);
  const embed = {
    author: { name: t(lang, 'moderation.log.author', { name: target.username ?? target.id, id: target.id }), icon_url: getAvatar(target) ?? undefined },
    description: [
      t(lang, 'moderation.log.title', { emoji: EMOJI.HAMMER, type: capitalize(typeName(modCase.type, lang)), number: modCase.case_number }),
      t(lang, 'moderation.log.moderator', { moderator: `<@${moderator.id}>`, name: moderator.username }),
      t(lang, 'moderation.log.duration', { duration: duration ?? t(lang, permanent ? 'moderation.log.permanent' : 'moderation.log.notApplicable') }),
      t(lang, 'moderation.log.reason', { reason: reasonText(reason, lang) }),
    ].join('\n'),
    color: COLORS[modCase.type] ?? 0x4b4f59,
    footer: { text: guild.name, icon_url: guild.iconURL({ extension: 'png', size: 128 }) ?? undefined },
    timestamp: new Date().toISOString(),
  };

  // The server's own design for the entry, when it has one.
  const custom = await sanctionLogEmbed({ modCase, guild, target, moderator, reason, duration, source, lang });
  await sendLog(client, guild.id, 'sanctions', custom ?? embed);
}

module.exports = { logSanction };
