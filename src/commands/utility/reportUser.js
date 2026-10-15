const { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/report');
const { buildReportModal, USER_MODAL_PREFIX } = require('../../interactions/reportModal');
const { noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

function refusal(text) {
  return { ...noticePayload(text, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

module.exports = {
  // i18n-ignore: context menu command name, never translated
  data: new ContextMenuCommandBuilder().setName('Report User').setType(ApplicationCommandType.User),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const reportConfig = await getConfig(interaction.guild.id).catch(() => null);
    if (!reportConfig?.enabled || !reportConfig.channel_id) {
      await interaction.reply(refusal(t(lang, 'reports.send.notSetUp')));
      return;
    }

    const target = interaction.targetUser;
    if (target.id === interaction.user.id) {
      await interaction.reply(refusal(t(lang, 'reports.send.self')));
      return;
    }

    await interaction.showModal(buildReportModal({
      customId: `${USER_MODAL_PREFIX}${target.id}`,
      title: t(lang, 'reports.form.userTitle'),
      intro: `### ${t(lang, 'reports.form.userIntro', { user: `${target}` })}\n${t(lang, 'reports.form.userLine', { user: `${target}`, id: target.id })}`,
      config: reportConfig,
      lang,
    }));
  },
};
