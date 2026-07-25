const { ContextMenuCommandBuilder, ApplicationCommandType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
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
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel('Why are you reporting this?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
        ),
      );

    await interaction.showModal(modal);
  },
};
