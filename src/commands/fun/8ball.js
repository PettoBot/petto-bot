const { SlashCommandBuilder } = require('discord.js');
const { EIGHT_BALL_ANSWERS, pickRandom } = require('../../utils/funGames');
const { infoPayload, clip } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

const TONE_COLOR = { yes: COLORS.GREEN, maybe: COLORS.YELLOW, no: COLORS.RED };

module.exports = {
  aliases: ['eightball'],
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a yes or no question.')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('question').setDescription('What do you want to know?').setRequired(true).setMaxLength(200)),

  async execute(interaction) {
    const question = interaction.options.getString('question', true).trim();
    const answer = pickRandom(EIGHT_BALL_ANSWERS);

    await interaction.reply(infoPayload({
      accent: TONE_COLOR[answer.tone],
      title: `🎱 ${answer.text}`,
      subtitle: [`> ${clip(question, 200)}`],
      footer: `Asked by ${interaction.member?.displayName ?? interaction.user.username}`,
    }));
  },
};
