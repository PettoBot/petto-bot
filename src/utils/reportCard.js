const { ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const { EMOJI } = require('./emojis');

/** Components V2 card posted to the configured report channel. */
function buildReportCard({ reporter, reportedUser, reason, sourceChannel, messageLink, messageContent, imageUrls = [], anonymous = false, urgent = false, urgentRoleId = null }) {
  const lines = [`### ${urgent ? EMOJI.REPORT_IMPORTANT : EMOJI.REPORT} New Report`];

  if (urgent && urgentRoleId) lines.push(`<@&${urgentRoleId}>`);
  lines.push(`**Reported by:** ${anonymous ? 'Anonymous' : `${reporter} (\`${reporter.id}\`)`}`);

  if (reportedUser) lines.push(`**Reported user:** ${reportedUser} (\`${reportedUser.id}\`)`);
  if (sourceChannel) lines.push(`**Channel:** ${sourceChannel}`);
  if (messageLink) lines.push(`**Message:** [Jump to message](${messageLink})`);
  if (messageContent) lines.push(`**Content:**\n> ${messageContent.slice(0, 500).replace(/\n/g, '\n> ')}`);

  lines.push(`**Additional context:** ${reason || 'No additional context provided.'}`);

  const card = new ContainerBuilder()
    .setAccentColor(0xfe6465)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  const images = [...new Set(imageUrls)].filter(Boolean).slice(0, 10);
  if (images.length) {
    card.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(images.map((url) => new MediaGalleryItemBuilder().setURL(url))),
    );
  }

  return card;
}

function buildReportPayload({ card, urgentRoleId = null }) {
  return {
    components: [card],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: urgentRoleId ? { parse: [], roles: [urgentRoleId] } : { parse: [] },
  };
}

module.exports = { buildReportCard, buildReportPayload };
