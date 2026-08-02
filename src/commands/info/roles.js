const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

module.exports = {
  aliases: ['rl'],
  data: new SlashCommandBuilder().setName('roles').setDescription('Lists every role in this server.'),

  async execute(interaction) {
    const roles = [...interaction.guild.roles.cache.filter((r) => r.id !== interaction.guild.id).values()].sort((a, b) => b.position - a.position);
    const text = roles.length ? roles.map((r) => `${r} — ${r.members.size} member(s)`).join('\n').slice(0, 4000) : 'No roles.';

    const embed = new EmbedBuilder().setColor(COLORS.BLUE).setTitle(`Roles (${roles.length})`).setDescription(text);
    await interaction.reply({ embeds: [embed] });
  },
};
