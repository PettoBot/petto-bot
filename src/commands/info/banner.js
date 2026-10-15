const { SlashCommandBuilder } = require('discord.js');
const { INFO_ACCENT, infoPayload, noticePayload } = require('../../utils/infoCard');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['bn'],
  data: new SlashCommandBuilder()
    .setName('banner')
    .setDescription("Shows a member's profile banner.")
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const target = interaction.options.getUser('user') ?? interaction.user;
    const user = await interaction.client.users.fetch(target.id, { force: true }).catch(() => target);

    if (!user.banner) {
      await interaction.reply(noticePayload(t(lang, 'info.banner.none', { name: user.username })));
      return;
    }

    const url = user.bannerURL({ size: 1024 });
    await interaction.reply(infoPayload({
      accent: user.accentColor || INFO_ACCENT,
      title: t(lang, 'info.banner.title', { name: user.globalName ?? user.username }),
      banner: url,
      footer: t(lang, 'info.card.id', { id: user.id }),
      buttons: [{ label: t(lang, 'info.button.openOriginal.button'), url }],
    }));
  },
};
