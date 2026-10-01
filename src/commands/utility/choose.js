const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseChoices, pickRandom } = require('../../utils/funGames');
const { infoPayload, noticePayload, clip } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

const MAX_CHOICES = 25;

module.exports = {
  aliases: ['pick', 'decide'],
  data: new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Let Petto decide between options: pizza, tacos, sushi.')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('options').setDescription('Two or more options separated by commas, or by " or "').setRequired(true).setMaxLength(500)),

  async execute(interaction) {
    const options = [...new Set(parseChoices(interaction.options.getString('options', true)))];

    if (options.length < 2 || options.length > MAX_CHOICES) {
      const text = options.length < 2
        ? 'Give me at least two options, separated by commas, for example `pizza, tacos, sushi`.'
        : `That is too many options. I can choose between ${MAX_CHOICES} at most.`;
      await interaction.reply({ ...noticePayload(text, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    const winner = pickRandom(options);
    await interaction.reply(infoPayload({
      title: clip(winner, 150),
      subtitle: [`I choose this one, **${interaction.member?.displayName ?? interaction.user.username}**.`],
      sections: [{ lines: [`-# From ${options.length} options: ${clip(options.join(' · '), 500)}`] }],
    }));
  },
};
