const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  aliases: ['clr', 'hex'],
  data: new SlashCommandBuilder()
    .setName('color')
    .setDescription('Previews a hex color.')
    .addStringOption((o) => o.setName('hex').setDescription('e.g. #ff91c2 or ff91c2').setRequired(true)),

  async execute(interaction) {
    const input = interaction.options.getString('hex', true).replace('#', '').trim();
    const num = parseInt(input, 16);

    if (input.length > 6 || Number.isNaN(num)) {
      await interaction.reply({ content: 'Provide a valid hex color, e.g. `#ff91c2`.' });
      return;
    }

    const hex = num.toString(16).padStart(6, '0');
    const embed = new EmbedBuilder().setColor(num).setTitle(`#${hex}`).setDescription(`RGB: ${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`);

    await interaction.reply({ embeds: [embed] });
  },
};
