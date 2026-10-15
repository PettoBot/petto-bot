const { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../../db/report');
const { buildReportModal, MESSAGE_MODAL_PREFIX } = require('../../interactions/reportModal');
const { noticePayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

function refusal(text) {
  return { ...noticePayload(text, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

module.exports = {
  // i18n-ignore: context menu command name, never translated
  data: new ContextMenuCommandBuilder().setName('Report Message').setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const reportConfig = await getConfig(interaction.guild.id).catch(() => null);
    if (!reportConfig?.enabled || !reportConfig.channel_id) {
      await interaction.reply(refusal(t(lang, 'reports.send.notSetUp')));
      return;
    }

    if (interaction.targetMessage.author.id === interaction.user.id) {
      await interaction.reply(refusal(t(lang, 'reports.form.ownMessage')));
      return;
    }

    const target = interaction.targetMessage;
    const quoted = (target.content?.trim() || t(lang, 'reports.form.noText')).slice(0, 500).replace(/@/g, '@​').replace(/\n/g, '\n> ');
    await interaction.showModal(buildReportModal({
      customId: `${MESSAGE_MODAL_PREFIX}${target.id}`,
      title: t(lang, 'reports.form.messageTitle'),
      intro: [
        `### ${t(lang, 'reports.form.messageIntro', { user: `${target.author}` })}`,
        `> ${quoted}`,
        t(lang, 'reports.form.messageBy', { user: `${target.author}`, time: `<t:${Math.floor(target.createdTimestamp / 1000)}:f>` }),
      ].join('\n'),
      config: reportConfig,
      lang,
    }));
  },
};
