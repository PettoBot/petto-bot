const { SlashCommandBuilder } = require('discord.js');
const { INFO_ACCENT, infoPayload, noticePayload } = require('../../utils/infoCard');

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
      await interaction.reply(noticePayload(`${user.username} doesn't have a banner set.`));
      return;
    }

    const url = user.bannerURL({ size: 1024 });
    await interaction.reply(infoPayload({
      accent: user.accentColor || INFO_ACCENT,
      title: `${user.globalName ?? user.username}'s banner`,
      banner: url,
      footer: `ID ${user.id}`,
      buttons: [{ label: 'Open original', url }],
    }));
  },
};
