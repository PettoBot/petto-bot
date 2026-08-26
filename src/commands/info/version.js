const { SlashCommandBuilder } = require('discord.js');
const { buildVersionPayload } = require('../../interactions/version');

module.exports = {
  // The release center is intentionally prefix-only. It is a public catalog,
  // but it should not add another global slash command to every server.
  prefixOnly: true,
  aliases: ['release', 'releases'],
  data: new SlashCommandBuilder()
    .setName('version')
    .setDescription('Browse Petto releases and published changes.')
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.reply(buildVersionPayload());
  },
};
