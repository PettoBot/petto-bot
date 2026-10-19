const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { setDraft } = require('../../utils/pollDrafts');
const { renderPanel } = require('../../interactions/pollPanel');
const { languageOf } = require('../../i18n');

module.exports = {
  // Also registered as a slash command (one of the everyday ones people look for with `/`); the prefix keeps working.
  registerSlash: true,
  aliases: ['pl'],
  data: new SlashCommandBuilder().setName('poll').setDescription('Build a poll members can vote on with buttons.').setDMPermission(false),
  interactive: true,

  async execute(interaction) {
    const lang = await languageOf(interaction);
    // Fresh draft every time /poll is run, so an old half-built poll never leaks into a new one.
    const draft = setDraft(interaction.user.id, { question: null, options: [], image: null, multi: false, duration: null });
    await interaction.reply({ ...renderPanel(interaction.user.id, draft, lang), flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] });
  },
};
