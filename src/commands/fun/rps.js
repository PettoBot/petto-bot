const { SlashCommandBuilder } = require('discord.js');
const { RPS_CHOICES, RPS_ICON, pickRandom, rpsOutcome } = require('../../utils/funGames');
const { infoPayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

const RESULT = {
  win: { title: 'You win!', color: COLORS.GREEN },
  lose: { title: 'I win!', color: COLORS.RED },
  tie: { title: 'It is a tie.', color: COLORS.YELLOW },
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
      await interaction.reply(infoPayload({ accent: COLORS.RED, title: 'Pick rock, paper or scissors.' }));
      return;
    }

    const bot = pickRandom(RPS_CHOICES);
    const result = RESULT[rpsOutcome(player, bot)];
    await interaction.reply(infoPayload({
      accent: result.color,
      title: result.title,
      subtitle: [`${RPS_ICON[player]} **${player}**  vs  ${RPS_ICON[bot]} **${bot}**`],
      footer: `Played by ${interaction.member?.displayName ?? interaction.user.username}`,
    }));
  },
};
