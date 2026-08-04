const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

module.exports = {
  aliases: ['bn'],
  data: new SlashCommandBuilder()
    .setName('banner')
    .setDescription("Shows a member's profile banner.")
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const user = await interaction.client.users.fetch(target.id, { force: true }).catch(() => target);

    if (!user.banner) {
      await interaction.reply({ content: `${user.username} doesn't have a banner set.` });
      return;
    }

    const embed = new EmbedBuilder().setColor(COLORS.DEFAULT).setTitle(`${user.username}'s banner`).setImage(user.bannerURL({ size: 1024 }));
    await interaction.reply({ embeds: [embed] });
  },
};
