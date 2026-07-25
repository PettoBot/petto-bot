const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Shows information about a role.')
    .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),

  async execute(interaction) {
    const role = interaction.options.getRole('role', true);

    const embed = new EmbedBuilder()
      .setColor(role.color || COLORS.BLUE)
      .setTitle(role.name)
      .addFields(
        { name: 'ID', value: role.id, inline: true },
        { name: 'Color', value: role.hexColor, inline: true },
        { name: 'Position', value: `${role.position}`, inline: true },
        { name: 'Members', value: `${role.members.size}`, inline: true },
        { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
        { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
        { name: 'Managed', value: role.managed ? 'Yes (bot/integration role)' : 'No', inline: true },
        { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
