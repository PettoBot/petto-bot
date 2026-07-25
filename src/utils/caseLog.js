const { sendLog, getAvatar } = require('../logging/engine');
const { TYPE_EMOJI } = require('./emojis');
const { COLORS } = require('./caseCard');

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Logs a single moderation case to the 'sanctions' category of the /logs system
 * (per-channel webhooks, same as messages/members/roles/etc). This is the only
 * place sanction actions get logged — there's no separate mod-log channel setting.
 */
async function logSanction(client, guild, { modCase, target, moderator, reason, duration }) {
  const emoji = TYPE_EMOJI[modCase.type] ?? '';

  const embed = {
    author: { name: `${target.username ?? target.id} (ID ${target.id})`, icon_url: getAvatar(target) ?? undefined },
    description: [
      `${emoji} **${capitalize(modCase.type)}** · Case #${modCase.case_number}`,
      `**Moderator:** <@${moderator.id}> (**${moderator.username}**)`,
      `**Duration:** ${duration ?? 'Permanent'}`,
      `**Reason:** ${reason || 'No reason provided.'}`,
    ].join('\n'),
    color: COLORS[modCase.type] ?? 0x8399ff,
    footer: { text: guild.name, icon_url: guild.iconURL({ extension: 'png', size: 128 }) ?? undefined },
    timestamp: new Date().toISOString(),
  };

  await sendLog(client, guild.id, 'sanctions', embed);
}

module.exports = { logSanction };
