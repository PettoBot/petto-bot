const {
  ApplicationCommandType,
  CheckboxBuilder,
  ContextMenuCommandBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getConfig } = require('../../db/report');

module.exports = {
  data: new ContextMenuCommandBuilder().setName('Report Message').setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const reportConfig = await getConfig(interaction.guild.id).catch(() => null);
    if (!reportConfig?.enabled || !reportConfig.channel_id) {
      await interaction.reply({ content: 'Reports are not set up on this server yet.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.targetMessage.author.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot report your own message.', flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`rp_msg::${interaction.targetMessage.id}`)
      .setTitle('Report Message')
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### Reported message by ${interaction.targetMessage.author}`,
          `> ${(interaction.targetMessage.content?.trim() || '*No text content.*').slice(0, 500).replace(/@/g, '@\u200b').replace(/\n/g, '\n> ')}`,
          `**By:** ${interaction.targetMessage.author} · <t:${Math.floor(interaction.targetMessage.createdTimestamp / 1000)}:f>`,
        ].join('\n')),
      )
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Additional Context')
          .setDescription('Anything the moderators should know (optional)')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('context')
              .setPlaceholder('Why are you reporting this?')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(500),
          ),
        ...(reportConfig.urgent_role_id ? [
          new LabelBuilder()
            .setLabel('Ping Moderators')
            .setDescription('Urgently notify the mod role (use wisely)')
            .setCheckboxComponent(new CheckboxBuilder().setCustomId('report_ping')),
        ] : []),
        ...(reportConfig.anonymous_reporting_enabled ? [
          new LabelBuilder()
            .setLabel('Report Anonymously')
            .setDescription('Your name won’t be shown in the report')
            .setCheckboxComponent(new CheckboxBuilder().setCustomId('report_anonymous')),
        ] : []),
      );

    await interaction.showModal(modal);
  },
};
