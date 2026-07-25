const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('firstmessage')
    .setDescription('Jumps to the first message in a channel.')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)').setRequired(false)),
  aliases: ['fm'],

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;

    const messages = await channel.messages.fetch({ after: '0', limit: 1 }).catch(() => null);
    const first = messages?.first();

    if (!first) {
      await interaction.reply({ content: "Couldn't find the first message in that channel." });
      return;
    }

    await interaction.reply({ content: `First message in ${channel}: ${first.url}` });
  },
};
