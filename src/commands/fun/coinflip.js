const { SlashCommandBuilder } = require('discord.js');
const { flipCoin, plainText } = require('../../utils/funPrompts');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['cf', 'flipcoin'],
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Flip a coin: heads or tails.')
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const side = flipCoin();
    const name = plainText(interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username, 60);
    await interaction.reply({
      content: `🪙 ${t(lang, 'fun.coinflip.title', { name })}: **${t(lang, `fun.coinflip.${side}`)}**`,
      allowedMentions: { parse: [], repliedUser: false },
    });
  },
};
