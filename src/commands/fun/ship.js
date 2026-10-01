const { AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
const { shipScore, shipVerdict } = require('../../utils/funGames');
const { buildShipCard } = require('../../imgutils/shipCard');
const logger = require('../../utils/logger');

function nameOf(guild, user) {
  return guild?.members?.cache?.get(user.id)?.displayName ?? user.globalName ?? user.username;
}

function avatarOf(guild, user) {
  const member = guild?.members?.cache?.get(user.id);
  return (member ?? user).displayAvatarURL({ extension: 'png', size: 256 });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ship')
    .setDescription('See how compatible two members are. The same pair always gets the same result.')
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('first').setDescription('The first member').setRequired(true))
    .addUserOption((opt) => opt.setName('second').setDescription('The second member (default: you)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const first = interaction.options.getUser('first', true);
    const second = interaction.options.getUser('second') ?? interaction.user;
    const score = shipScore(first.id, second.id);
    const nameA = nameOf(interaction.guild, first);
    const nameB = nameOf(interaction.guild, second);
    const text = `💞 **${nameA}** × **${nameB}**: **${score}%** · ${shipVerdict(score)}`;

    try {
      const card = await buildShipCard({ avatarA: avatarOf(interaction.guild, first), avatarB: avatarOf(interaction.guild, second), nameA, nameB, score });
      await interaction.editReply({ content: text, files: [new AttachmentBuilder(card, { name: 'ship.png' })], allowedMentions: { parse: [] } });
    } catch (err) {
      // The picture is a bonus: the result is still told when it cannot be drawn.
      logger.warn(`Could not draw the ship card: ${err.message}`);
      await interaction.editReply({ content: text, allowedMentions: { parse: [] } });
    }
  },
};
