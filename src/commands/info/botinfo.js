const { SlashCommandBuilder, EmbedBuilder, version: djsVersion } = require('discord.js');
const { COLORS } = require('../../utils/colors');
const { formatDuration } = require('../../utils/duration');

module.exports = {
  data: new SlashCommandBuilder().setName('botinfo').setDescription('Shows information about Petto.'),
  aliases: ['about'],

  async execute(interaction) {
    const client = interaction.client;
    const memoryMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    const embed = new EmbedBuilder()
      .setColor(COLORS.DEFAULT)
      .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL() })
      .addFields(
        { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
        { name: 'Uptime', value: formatDuration(client.uptime), inline: true },
        { name: 'Memory usage', value: `${memoryMb} MB`, inline: true },
        { name: 'discord.js', value: djsVersion, inline: true },
        { name: 'Node.js', value: process.version, inline: true },
        { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
