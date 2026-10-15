const { SlashCommandBuilder } = require('discord.js');
const { t, languageOf } = require('../../i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('firstmessage')
    .setDescription('Jumps to the first message in a channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)').setRequired(false)),
  aliases: ['fm'],

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;

    const messages = await channel.messages.fetch({ after: '0', limit: 1 }).catch(() => null);
    const first = messages?.first();

    if (!first) {
      await interaction.reply({ content: t(lang, 'info.firstmessage.none') });
      return;
    }

    await interaction.reply({ content: t(lang, 'info.firstmessage.found', { channel: `${channel}`, url: first.url }) });
  },
};
