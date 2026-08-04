const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Shows a member's avatar.")
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)),
  aliases: ['av', 'pfp'],

  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild?.members.cache.get(user.id);

    const embed = new EmbedBuilder().setColor(COLORS.DEFAULT).setTitle(`${user.username}'s avatar`).setImage(user.displayAvatarURL({ size: 1024 }));

    if (member?.avatar && member.displayAvatarURL() !== user.displayAvatarURL()) {
      embed.setDescription(`[Global avatar](${user.displayAvatarURL({ size: 1024 })}) · [Server avatar](${member.displayAvatarURL({ size: 1024 })})`);
      embed.setImage(member.displayAvatarURL({ size: 1024 }));
    }

    await interaction.reply({ embeds: [embed] });
  },
};
