const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  aliases: ['p'],
  data: new SlashCommandBuilder().setName('ping').setDescription("Shows Petto's latency."),

  async execute(interaction) {
    const startedAt = interaction.createdTimestamp ?? interaction.rawMessage?.createdTimestamp ?? Date.now();
    const sent = await interaction.reply({ content: 'Pinging...' });
    const roundtrip = sent.createdTimestamp - startedAt;
    await interaction.editReply(`🏓 Pong! Roundtrip: **${roundtrip}ms** · WebSocket: **${Math.round(interaction.client.ws.ping)}ms**`);
  },
};
