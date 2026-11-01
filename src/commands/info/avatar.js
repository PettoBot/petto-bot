const { SlashCommandBuilder } = require('discord.js');
const { INFO_ACCENT, infoPayload } = require('../../utils/infoCard');
const { t, languageOf } = require('../../i18n');

module.exports = {
  // Not registered as a slash command any more: `/user avatar` replaces it (same options, same code). It keeps working with the prefix.
  registerSlash: false,
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDMPermission(false)
    .setDescription("Shows a member's avatar.")
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)),
  aliases: ['av', 'pfp'],

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild?.members.cache.get(user.id);

    const globalAvatar = user.displayAvatarURL({ size: 1024 });
    const serverAvatar = member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null;
    const hasServerAvatar = Boolean(serverAvatar) && serverAvatar !== globalAvatar;

    await interaction.reply(infoPayload({
      accent: member?.displayColor || INFO_ACCENT,
      title: t(lang, 'info.avatar.title', { name: member?.displayName ?? user.username }),
      subtitle: [hasServerAvatar ? t(lang, 'info.avatar.showingServer') : null],
      banner: hasServerAvatar ? serverAvatar : globalAvatar,
      footer: t(lang, 'info.card.id', { id: user.id }),
      buttons: [
        { label: t(lang, hasServerAvatar ? 'info.button.globalAvatar.button' : 'info.button.openOriginal.button'), url: globalAvatar },
        { label: t(lang, 'info.button.serverAvatar.button'), url: hasServerAvatar ? serverAvatar : null },
      ],
    }));
  },
};
