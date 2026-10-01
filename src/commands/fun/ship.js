const { SlashCommandBuilder } = require('discord.js');
const { shipScore, shipVerdict, shipBar } = require('../../utils/funGames');
const { infoPayload } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

function nameOf(guild, user) {
  return guild?.members?.cache?.get(user.id)?.displayName ?? user.globalName ?? user.username;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ship')
    .setDescription('See how compatible two members are. The same pair always gets the same result.')
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('first').setDescription('The first member').setRequired(true))
    .addUserOption((opt) => opt.setName('second').setDescription('The second member (default: you)').setRequired(false)),

  async execute(interaction) {
    const first = interaction.options.getUser('first', true);
    const second = interaction.options.getUser('second') ?? interaction.user;
    const score = shipScore(first.id, second.id);
    const nameA = nameOf(interaction.guild, first);
    const nameB = nameOf(interaction.guild, second);

    await interaction.reply(infoPayload({
      accent: score >= 75 ? 0xff7eb6 : score >= 35 ? COLORS.YELLOW : COLORS.DEFAULT,
      title: `💞 ${nameA} × ${nameB}`,
      subtitle: [`${shipBar(score)}  **${score}%**`, shipVerdict(score)],
      thumbnail: first.displayAvatarURL({ size: 256 }),
    }));
  },
};
