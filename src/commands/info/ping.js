const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  aliases: ['p'],
  data: new SlashCommandBuilder().setName('ping').setDescription("Shows Petto's latency."),

  async execute(interaction) {
    const startedAt = Date.now();
    await interaction.reply({ content: 'Pinging...' });
    const sent = await interaction.fetchReply().catch(() => null);
    const roundtrip = Math.max(0, (sent?.createdTimestamp ?? Date.now()) - startedAt);
    const websocket = Number.isFinite(interaction.client.ws.ping) ? `${Math.round(interaction.client.ws.ping)}ms` : 'N/A';
    await interaction.editReply(`🏓 Pong! Roundtrip: **${roundtrip}ms** · WebSocket: **${websocket}**`);
  },
};
