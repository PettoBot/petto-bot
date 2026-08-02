const { SlashCommandBuilder } = require('discord.js');
const { formatDuration } = require('../../utils/duration');

module.exports = {
  aliases: ['up'],
  data: new SlashCommandBuilder().setName('uptime').setDescription('Shows how long Petto has been running.'),

  async execute(interaction) {
    await interaction.reply({ content: `Petto has been online for **${formatDuration(interaction.client.uptime)}**.` });
  },
};
