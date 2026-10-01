const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { loadSetupState, buildSetupPanel } = require('../../interactions/setupPanel');

module.exports = {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('See what is configured in this server and run the quick setup form.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    // Acknowledge first: the panel reads several settings, and none of that may count against Discord's 3 second window.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    const state = await loadSetupState(interaction.guild, { fresh: true });
    await interaction.editReply(buildSetupPanel(interaction.guild, state));
  },
};
