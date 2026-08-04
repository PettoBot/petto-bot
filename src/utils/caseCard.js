const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { TYPE_EMOJI } = require('./emojis');

const COLORS = {
  ban: 0xfe6465,
  tempban: 0xfe6465,
  softban: 0xfe6465,
  unban: 0xa5ea7a,
  kick: 0xfed53c,
  mute: 0xfed53c,
  tempmute: 0xfed53c,
  unmute: 0xa5ea7a,
  warn: 0xfed53c,
};

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Components V2 case card — used for both the command reply and the mod-log channel. */
function buildCaseCard({ caseNumber, type, target, moderator, reason, duration }) {
  const emoji = TYPE_EMOJI[type] ?? '';
  const lines = [
    `### ${emoji} Case #${caseNumber} · ${capitalize(type)}`.trim(),
    `**User:** ${target} (\`${target.id ?? target}\`)`,
    `**Moderator:** ${moderator}`,
  ];
  if (duration) lines.push(`**Duration:** ${duration}`);
  lines.push(`**Reason:** ${reason || 'No reason provided.'}`);

  return new ContainerBuilder()
    .setAccentColor(COLORS[type] ?? 0x4b4f59)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

/** A single-block Components V2 card for plain status text (errors, confirmations) once a reply is already in V2 mode. */
function textCard(text, color = 0x4b4f59) {
  return new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

module.exports = { buildCaseCard, textCard, COLORS };
