const { SlashCommandBuilder } = require('discord.js');
const { RPS_CHOICES, RPS_ICON, pickRandom, rpsOutcome } = require('../../utils/funGames');

const RESULT = {
  win: 'You win!',
  lose: 'I win!',
  tie: 'It is a tie.',
};

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
    const player = interaction.options.getString('choice', true).toLowerCase();
    if (!RPS_CHOICES.includes(player)) {
      await interaction.reply({ content: 'Pick rock, paper or scissors.' });
      return;
    }

    const bot = pickRandom(RPS_CHOICES);
    const result = RESULT[rpsOutcome(player, bot)];
    await interaction.reply({
      content: `${RPS_ICON[player]} **${player}**  vs  ${RPS_ICON[bot]} **${bot}**\n**${result}**`,
      allowedMentions: { parse: [] },
    });
  },
};
