const { MessageFlags } = require('discord.js');
const { getConfig } = require('../db/report');
const { buildReportCard } = require('../utils/reportCard');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');

/** Handles the modal shown by the "Report Message" context menu command (customId `rp_msg::<messageId>`). */
async function handleModal(interaction) {
  const [, messageId] = interaction.customId.split('::');
  const reason = interaction.fields.getTextInputValue('reason');

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

  const card = buildReportCard({
    reporter: interaction.user,
    reportedUser: message?.author,
    reason,
    sourceChannel: interaction.channel,
    messageLink: message?.url,
    messageContent: message?.content || undefined,
  });

  await channel.send({ components: [card], flags: MessageFlags.IsComponentsV2 }).catch((err) => {
    logger.error('Failed to deliver message report:', err);
    throw err;
  });

  await interaction.editReply({ content: `${EMOJI.APPROVE} Your report was sent to the staff team. Thank you.` });
}

module.exports = { handleModal };
