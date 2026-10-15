const { SlashCommandBuilder } = require('discord.js');
const { formatDuration } = require('../../utils/duration');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['up'],
  data: new SlashCommandBuilder().setName('uptime').setDescription('Shows how long Petto has been running.'),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.reply({ content: t(lang, 'info.uptime.online', { duration: formatDuration(interaction.client.uptime, lang) }) });
  },
};
