const { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/report');
const { buildReportModal, USER_MODAL_PREFIX } = require('../../interactions/reportModal');
const { noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

function refusal(text) {
  return { ...noticePayload(text, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

module.exports = {
  data: new ContextMenuCommandBuilder().setName('Report User').setType(ApplicationCommandType.User),

  async execute(interaction) {
    const reportConfig = await getConfig(interaction.guild.id).catch(() => null);
    if (!reportConfig?.enabled || !reportConfig.channel_id) {
      await interaction.reply(refusal('Reports are not set up on this server yet.'));
      return;
    }

    const target = interaction.targetUser;
    if (target.id === interaction.user.id) {
      await interaction.reply(refusal('You cannot report yourself.'));
      return;
    }

    await interaction.showModal(buildReportModal({
      customId: `${USER_MODAL_PREFIX}${target.id}`,
      title: 'Report User',
      intro: `### Reporting ${target}\n**User:** ${target} (\`${target.id}\`)`,
      config: reportConfig,
    }));
  },
};
