const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { setDraft } = require('../../utils/pollDrafts');
const { renderPanel } = require('../../interactions/pollPanel');

module.exports = {
  data: new SlashCommandBuilder().setName('poll').setDescription('Build a poll members can vote on with buttons.').setDMPermission(false),
  interactive: true,

  async execute(interaction) {
    // Fresh draft every time /poll is run, so an old half-built poll never leaks into a new one.
    const draft = setDraft(interaction.user.id, { question: null, options: [], image: null, multi: false, duration: null });
    await interaction.reply({ ...renderPanel(interaction.user.id, draft), flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] });
  },
};
