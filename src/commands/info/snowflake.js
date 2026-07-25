const { SlashCommandBuilder } = require('discord.js');

const DISCORD_EPOCH = 1420070400000n;

function timestampFromSnowflake(id) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('snowflake')
    .setDescription('Decodes the creation timestamp embedded in any Discord ID.')
    .addStringOption((o) => o.setName('id').setDescription('A Discord ID (user, channel, role, message, ...)').setRequired(true)),

  async execute(interaction) {
    const id = interaction.options.getString('id', true).trim();
    if (!/^\d{17,20}$/.test(id)) {
      await interaction.reply({ content: "That doesn't look like a valid Discord ID." });
      return;
    }

    const ts = timestampFromSnowflake(id);
    await interaction.reply({ content: `**${id}** was created <t:${Math.floor(ts / 1000)}:F> (<t:${Math.floor(ts / 1000)}:R>).` });
  },
};
