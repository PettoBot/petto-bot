const { MessageFlags } = require('discord.js');
const { getConfig } = require('../db/report');
const { buildReportCard, buildReportPayload } = require('../utils/reportCard');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');

const IMAGE_URL_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;

function collectImageUrls(message) {
  const urls = [];
  for (const attachment of message.attachments?.values?.() ?? []) {
    if (attachment.contentType?.startsWith('image/') || IMAGE_URL_RE.test(attachment.url ?? '')) urls.push(attachment.url);
  }

  for (const embed of message.embeds ?? []) {
    if (embed.image?.url) urls.push(embed.image.url);
    if (embed.thumbnail?.url) urls.push(embed.thumbnail.url);
  }

  return [...new Set(urls)].slice(0, 10);
}

/** Handles the modal shown by the "Report Message" context menu command (customId `rp_msg::<messageId>`). */
async function handleModal(interaction) {
  const [, messageId] = interaction.customId.split('::');
  const reason = interaction.fields.getTextInputValue('context')?.trim() || '';

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const reportConfig = await getConfig(interaction.guild.id).catch(() => null);
  if (!reportConfig?.enabled || !reportConfig.channel_id) {
    await interaction.editReply({ content: 'Reports are not set up on this server yet.' });
    return;
  }

  const channel = await interaction.guild.channels.fetch(reportConfig.channel_id).catch(() => null);
  if (!channel) {
    await interaction.editReply({ content: 'The configured report channel no longer exists. Ask staff to run `/report config` again.' });
    return;
  }

  const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    await interaction.editReply({ content: 'That message is no longer available to report.' });
    return;
  }

  const urgent = Boolean(reportConfig.urgent_role_id) && interaction.fields.getCheckbox('report_ping') === true;
  const anonymous = reportConfig.anonymous_reporting_enabled === true && interaction.fields.getCheckbox('report_anonymous') === true;
  const card = buildReportCard({
    reporter: interaction.user,
    reportedUser: message.author,
    reason,
    sourceChannel: interaction.channel,
    messageLink: message.url,
    messageContent: message.content || undefined,
    imageUrls: collectImageUrls(message),
    anonymous,
    urgent,
    urgentRoleId: reportConfig.urgent_role_id,
  });

  await channel.send(buildReportPayload({ card, urgentRoleId: urgent ? reportConfig.urgent_role_id : null })).catch((err) => {
    logger.error('Failed to deliver message report:', err);
    throw err;
  });

  await interaction.editReply({ content: `${EMOJI.APPROVE} Your report was sent to the staff team. Thank you.` });
}

module.exports = { handleModal };
