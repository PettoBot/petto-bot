const { sendLog, getAvatar } = require('../logging/engine');
const { TYPE_EMOJI } = require('./emojis');
const { COLORS } = require('./caseCard');
const { sanctionLogEmbed } = require('./sanctionTemplates');

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Logs a single moderation case to the 'sanctions' category of the /logs system
 * (per-channel webhooks, same as messages/members/roles/etc). This is the only
 * place sanction actions get logged — there's no separate mod-log channel setting.
 */
async function logSanction(client, guild, { modCase, target, moderator, reason, duration, source = 'moderator' }) {
  const emoji = TYPE_EMOJI[modCase.type] ?? '';

  const embed = {
    author: { name: `${target.username ?? target.id} (ID ${target.id})`, icon_url: getAvatar(target) ?? undefined },
    description: [
      `${emoji} **${capitalize(modCase.type)}** · Case #${modCase.case_number}`,
      `**Moderator:** <@${moderator.id}> (**${moderator.username}**)`,
      `**Duration:** ${duration ?? 'Permanent'}`,
      `**Reason:** ${reason || 'No reason provided.'}`,
    ].join('\n'),
    color: COLORS[modCase.type] ?? 0x4b4f59,
    footer: { text: guild.name, icon_url: guild.iconURL({ extension: 'png', size: 128 }) ?? undefined },
    timestamp: new Date().toISOString(),
  };

  // The server's own design for the entry, when it has one.
  const custom = await sanctionLogEmbed({ modCase, guild, target, moderator, reason, duration, source });
  await sendLog(client, guild.id, 'sanctions', custom ?? embed);
}

module.exports = { logSanction };
