const { SlashCommandBuilder, version: djsVersion } = require('discord.js');
const { infoPayload, line } = require('../../utils/infoCard');
const { formatDuration } = require('../../utils/duration');
const { version: pettoVersion } = require('../../../package.json');
const { t, formatDecimal, languageOf } = require('../../i18n');

module.exports = {
  // Also registered as a slash command (one of the everyday ones people look for with `/`); the prefix keeps working.
  registerSlash: true,
  data: new SlashCommandBuilder().setName('botinfo').setDescription('Shows information about Petto.').setDMPermission(false),
  aliases: ['about'],

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const client = interaction.client;
    const memoryMb = formatDecimal(lang, Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)), 1);
    const ping = Number.isFinite(client.ws.ping) ? `${Math.round(client.ws.ping)}ms` : t(lang, 'info.ping.unknown');

    await interaction.reply(infoPayload({
      title: client.user.username,
      thumbnail: client.user.displayAvatarURL({ size: 512 }),
      subtitle: [t(lang, 'info.botinfo.about')],
      sections: [
        {
          title: t(lang, 'info.botinfo.status'),
          lines: [
            line(t(lang, 'info.botinfo.servers'), client.guilds.cache.size),
            line(t(lang, 'info.botinfo.uptime'), formatDuration(client.uptime, lang)),
            line(t(lang, 'info.botinfo.ping'), ping),
            line(t(lang, 'info.botinfo.memory'), `${memoryMb} MB`),
          ],
        },
        {
          title: t(lang, 'info.botinfo.runtime'),
          lines: [
            line('Petto', `v${pettoVersion}`),
            line('discord.js', djsVersion),
            line('Node.js', process.version),
          ],
        },
      ],
      footer: t(lang, 'info.card.id', { id: client.user.id }),
      buttons: [
        { label: t(lang, 'info.button.dashboard.button'), url: 'https://petto.sbs/dash' },
        { label: t(lang, 'info.button.changelog.button'), url: 'https://petto.sbs/changelog/' },
        { label: t(lang, 'info.button.repository.button'), url: 'https://github.com/PettoBot/petto-bot' },
      ],
    }));
  },
};
