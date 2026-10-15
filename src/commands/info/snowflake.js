const { SlashCommandBuilder } = require('discord.js');
const { t, languageOf } = require('../../i18n');

const DISCORD_EPOCH = 1420070400000n;

function timestampFromSnowflake(id) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

module.exports = {
  aliases: ['sf', 'id'],
  data: new SlashCommandBuilder()
    .setName('snowflake')
    .setDescription('Decodes the creation timestamp embedded in any Discord ID.')
    .addStringOption((o) => o.setName('id').setDescription('A Discord ID (user, channel, role, message, ...)').setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const id = interaction.options.getString('id', true).trim();
    if (!/^\d{17,20}$/.test(id)) {
      await interaction.reply({ content: t(lang, 'info.snowflake.invalid') });
      return;
    }

    const ts = timestampFromSnowflake(id);
    await interaction.reply({ content: t(lang, 'info.snowflake.created', { id, date: `<t:${Math.floor(ts / 1000)}:F>`, relative: `<t:${Math.floor(ts / 1000)}:R>` }) });
  },
};
