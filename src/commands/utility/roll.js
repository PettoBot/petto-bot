const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { DiceError, rollDice, describeTerm } = require('../../utils/dice');
const { infoPayload, noticePayload, clip } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

module.exports = {
  aliases: ['dice'],
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice: 2d6+3, d20, or 4d6kh3 to keep the highest three.')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('dice').setDescription('For example 2d6+3, d20, 4d6kh3 or 2d20kl1').setRequired(true).setMaxLength(100)),

  async execute(interaction) {
    const input = interaction.options.getString('dice', true);

    let result;
    try {
      result = rollDice(input);
    } catch (err) {
      if (!(err instanceof DiceError)) throw err;
      await interaction.reply({ ...noticePayload(err.message, COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    const single = result.terms.length === 1 && result.terms[0].type === 'dice' ? result.terms[0] : null;
    const natural = single && single.count === 1 && single.sides === 20 ? single.rolls[0] : null;
    const flair = natural === 20 ? ' · **Natural 20!**' : natural === 1 ? ' · **Natural 1…**' : '';

    const breakdown = result.terms.map((term, index) => {
      const sign = term.sign === -1 ? '− ' : index === 0 ? '' : '+ ';
      return `${sign}${describeTerm(term)}`;
    });

    await interaction.reply(infoPayload({
      accent: natural === 20 ? COLORS.GREEN : natural === 1 ? COLORS.RED : 0x8c7cff,
      title: `🎲 ${result.total}`,
      subtitle: [`**${interaction.member?.displayName ?? interaction.user.username}** rolled \`${clip(input.replace(/\s+/g, ''), 60)}\`${flair}`],
      sections: [{ lines: [clip(breakdown.join(' '), 900), `-# Range ${result.min} to ${result.max}`] }],
    }));
  },
};
