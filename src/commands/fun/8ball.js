const { SlashCommandBuilder } = require('discord.js');
const { EIGHT_BALL_ANSWERS, pickRandom } = require('../../utils/funGames');
const { clip } = require('../../utils/infoCard');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['eightball'],
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a yes or no question.')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('question').setDescription('What do you want to know?').setRequired(true).setMaxLength(200)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const question = interaction.options.getString('question', true).trim();
    const answer = pickRandom(EIGHT_BALL_ANSWERS);

    await interaction.reply({
      content: `🎱 **${t(lang, answer.key)}**\n> ${clip(question.replace(/\s+/g, " "), 200)}`,
      allowedMentions: { parse: [] },
    });
  },
};
