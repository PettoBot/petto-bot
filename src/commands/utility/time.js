const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

function formatTime(zone) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: zone }).format(new Date());
}

module.exports = {
  aliases: ['tz', 'clock'],
  data: new SlashCommandBuilder()
    .setName('time')
    .setDescription('Show the current time in a time zone.')
    .addStringOption((option) => option.setName('timezone').setDescription('IANA zone, for example Europe/Madrid or America/El_Salvador').setRequired(false)),

  async execute(interaction) {
    const zone = interaction.options.getString('timezone')?.trim() || 'UTC';
    let value;
    try {
      value = formatTime(zone);
    } catch {
      await interaction.reply({ content: 'That time zone is not valid. Use an IANA name such as `America/El_Salvador` or `Europe/Madrid`.' });
      return;
    }

    const unix = Math.floor(Date.now() / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.DEFAULT)
      .setTitle('Current time')
      .setDescription(`**${value}**\n<t:${unix}:F>\n<t:${unix}:R>`)
      .setFooter({ text: `Time zone: ${zone}` });
    await interaction.reply({ embeds: [embed] });
  },
};
