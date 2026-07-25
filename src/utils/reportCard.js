const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { EMOJI } = require('./emojis');

/** Components V2 card posted to the configured report channel — used by both /report send and the "Report Message" context menu. */
function buildReportCard({ reporter, reportedUser, reason, sourceChannel, messageLink, messageContent }) {
  const lines = [`### ${EMOJI.ALERT} New Report`, `**Reported by:** ${reporter} (\`${reporter.id}\`)`];

  if (reportedUser) lines.push(`**Reported user:** ${reportedUser} (\`${reportedUser.id}\`)`);
  if (sourceChannel) lines.push(`**Channel:** ${sourceChannel}`);
  if (messageLink) lines.push(`**Message:** [Jump to message](${messageLink})`);
  if (messageContent) lines.push(`**Content:**\n> ${messageContent.slice(0, 500).replace(/\n/g, '\n> ')}`);

  lines.push(`**Reason:** ${reason}`);

  return new ContainerBuilder().setAccentColor(0xfe6465).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

module.exports = { buildReportCard };
