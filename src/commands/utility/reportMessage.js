const { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/report');
const { buildReportModal, MESSAGE_MODAL_PREFIX } = require('../../interactions/reportModal');
const { noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

function refusal(text) {
  return { ...noticePayload(text, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

module.exports = {
  data: new ContextMenuCommandBuilder().setName('Report Message').setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const reportConfig = await getConfig(interaction.guild.id).catch(() => null);
    if (!reportConfig?.enabled || !reportConfig.channel_id) {
      await interaction.reply(refusal('Reports are not set up on this server yet.'));
      return;
    }

    if (interaction.targetMessage.author.id === interaction.user.id) {
      await interaction.reply(refusal('You cannot report your own message.'));
      return;
    }

    const target = interaction.targetMessage;
    const quoted = (target.content?.trim() || '*No text content.*').slice(0, 500).replace(/@/g, '@​').replace(/\n/g, '\n> ');
    await interaction.showModal(buildReportModal({
      customId: `${MESSAGE_MODAL_PREFIX}${target.id}`,
      title: 'Report Message',
      intro: [
        `### Reported message by ${target.author}`,
        `> ${quoted}`,
        `**By:** ${target.author} · <t:${Math.floor(target.createdTimestamp / 1000)}:f>`,
      ].join('\n'),
      config: reportConfig,
    }));
  },
};
