const { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/report');
const { buildReportModal, USER_MODAL_PREFIX } = require('../../interactions/reportModal');
const { noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

function refusal(text) {
  return { ...noticePayload(text, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

// The same report as "Report User", reachable from the Apps list of a message. It reports the person who wrote the
// message, not the message itself: "Report Message" is the one that attaches the text and the images.
module.exports = {
  data: new ContextMenuCommandBuilder().setName('Report Author').setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const reportConfig = await getConfig(interaction.guild.id).catch(() => null);
    if (!reportConfig?.enabled || !reportConfig.channel_id) {
      await interaction.reply(refusal('Reports are not set up on this server yet.'));
      return;
    }

    const author = interaction.targetMessage.author;
    if (author.id === interaction.user.id) {
      await interaction.reply(refusal('You cannot report yourself.'));
      return;
    }

    await interaction.showModal(buildReportModal({
      customId: `${USER_MODAL_PREFIX}${author.id}`,
      title: 'Report Author',
      intro: `### Reporting ${author}\n**User:** ${author} (\`${author.id}\`)\n-# This reports the person. To report the message itself, use **Report Message**.`,
      config: reportConfig,
    }));
  },
};
