const { SlashCommandBuilder, version: djsVersion } = require('discord.js');
const { infoPayload, line } = require('../../utils/infoCard');
const { formatDuration } = require('../../utils/duration');
const { readTotals } = require('../../utils/botTotals');
const { version: pettoVersion } = require('../../../package.json');
const { t, formatDecimal, languageOf } = require('../../i18n');

module.exports = {
  // A prefix command: its slash entry is inside `/levels` or `/bot` (utils/umbrella.js).
  data: new SlashCommandBuilder().setName('botinfo').setDescription('Shows information about Petto.').setDMPermission(false),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const client = interaction.client;
    const totals = await readTotals(client); // the servers of the whole bot, not only the ones of the shards of this instance
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
            line(t(lang, 'info.botinfo.servers'), totals.servers),
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
        { label: t(lang, 'core.join.support.button'), url: 'https://petto.sbs/support' },
      ],
    }));
  },
};
