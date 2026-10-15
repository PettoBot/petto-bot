const { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/report');
const { buildReportModal, USER_MODAL_PREFIX } = require('../../interactions/reportModal');
const { noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

function refusal(text) {
  return { ...noticePayload(text, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

// "Report User" for the Apps list of a message (the user menu of the same name only shows on a profile). It reports
// the person who wrote the message, not the message itself: "Report Message" is the one that attaches the text and
// the images.
module.exports = {
  // i18n-ignore: context menu command name, never translated
  data: new ContextMenuCommandBuilder().setName('Report User').setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const reportConfig = await getConfig(interaction.guild.id).catch(() => null);
    if (!reportConfig?.enabled || !reportConfig.channel_id) {
      await interaction.reply(refusal(t(lang, 'reports.send.notSetUp')));
      return;
    }

    const author = interaction.targetMessage.author;
    if (author.id === interaction.user.id) {
      await interaction.reply(refusal(t(lang, 'reports.send.self')));
      return;
    }

    await interaction.showModal(buildReportModal({
      customId: `${USER_MODAL_PREFIX}${author.id}`,
      title: t(lang, 'reports.form.userTitle'),
      intro: `### ${t(lang, 'reports.form.userIntro', { user: `${author}` })}\n${t(lang, 'reports.form.userLine', { user: `${author}`, id: author.id })}\n-# ${t(lang, 'reports.form.personNotMessage', { command: 'Report Message' })}`, // i18n-ignore: the name of a context menu command is never translated
      config: reportConfig,
      lang,
    }));
  },
};
