const { SlashCommandBuilder, version: djsVersion } = require('discord.js');
const { infoPayload, line } = require('../../utils/infoCard');
const { formatDuration } = require('../../utils/duration');
const { version: pettoVersion } = require('../../../package.json');

module.exports = {
  data: new SlashCommandBuilder().setName('botinfo').setDescription('Shows information about Petto.'),
  aliases: ['about'],

  async execute(interaction) {
    const client = interaction.client;
    const memoryMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const ping = Number.isFinite(client.ws.ping) ? `${Math.round(client.ws.ping)}ms` : 'N/A';

    await interaction.reply(infoPayload({
      title: client.user.username,
      thumbnail: client.user.displayAvatarURL({ size: 512 }),
      subtitle: ['Moderation, automation and community tools for Discord servers.'],
      sections: [
        {
          title: 'Status',
          lines: [
            line('Servers', client.guilds.cache.size),
            line('Uptime', formatDuration(client.uptime)),
            line('Ping', ping),
            line('Memory', `${memoryMb} MB`),
          ],
        },
        {
          title: 'Runtime',
          lines: [
            line('Petto', `v${pettoVersion}`),
            line('discord.js', djsVersion),
            line('Node.js', process.version),
          ],
        },
      ],
      footer: `ID ${client.user.id}`,
      buttons: [
        { label: 'Dashboard', url: 'https://petto.sbs/dash' },
        { label: 'Changelog', url: 'https://petto.sbs/changelog/' },
        { label: 'Repository', url: 'https://github.com/PettoBot/petto-bot' },
      ],
    }));
  },
};
