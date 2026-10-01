const { SlashCommandBuilder } = require('discord.js');
const { INFO_ACCENT, infoPayload } = require('../../utils/infoCard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Shows a member's avatar.")
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)),
  aliases: ['av', 'pfp'],

  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild?.members.cache.get(user.id);

    const globalAvatar = user.displayAvatarURL({ size: 1024 });
    const serverAvatar = member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null;
    const hasServerAvatar = Boolean(serverAvatar) && serverAvatar !== globalAvatar;

    await interaction.reply(infoPayload({
      accent: member?.displayColor || INFO_ACCENT,
      title: `${member?.displayName ?? user.username}'s avatar`,
      subtitle: [hasServerAvatar ? 'Showing the server avatar.' : null],
      banner: hasServerAvatar ? serverAvatar : globalAvatar,
      footer: `ID ${user.id}`,
      buttons: [
        { label: hasServerAvatar ? 'Global avatar' : 'Open original', url: globalAvatar },
        { label: 'Server avatar', url: hasServerAvatar ? serverAvatar : null },
      ],
    }));
  },
};
