const { SlashCommandBuilder } = require('discord.js');
const { RPS_CHOICES, RPS_ICON, pickRandom, rpsOutcome } = require('../../utils/funGames');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['rockpaperscissors'],
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Play rock, paper, scissors against Petto.')
    .setDMPermission(false)
    .addStringOption((opt) => opt
      .setName('choice')
      .setDescription('Your move')
      .setRequired(true)
      .addChoices(...RPS_CHOICES.map((name) => ({ name, value: name })))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const player = interaction.options.getString('choice', true).toLowerCase();
    if (!RPS_CHOICES.includes(player)) {
      await interaction.reply({ content: t(lang, 'fun.rps.pick') });
      return;
    }

    const bot = pickRandom(RPS_CHOICES);
    const result = t(lang, `fun.rps.result.${rpsOutcome(player, bot)}`);
    // The moves are typed in English (`!rps rock`); they are shown in the server's language.
    const move = (choice) => t(lang, `fun.rps.move.${choice}`);
    await interaction.reply({
      content: `${RPS_ICON[player]} **${move(player)}**  vs  ${RPS_ICON[bot]} **${move(bot)}**\n**${result}**`,
      allowedMentions: { parse: [] },
    });
  },
};
