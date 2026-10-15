const { SlashCommandBuilder } = require('discord.js');
const { register, sendPager } = require('../../utils/pager');
const { t, tn } = require('../../i18n');

register('boosters', {
  async load(guild, { lang }) {
    const boosters = [...guild.members.cache.filter((member) => member.premiumSinceTimestamp).values()]
      .sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp);
    return {
      title: t(lang, 'info.boosters.title', { count: boosters.length }),
      subtitle: [tn(lang, 'info.boosters.subtitle', guild.premiumSubscriptionCount ?? 0, { server: guild.name, level: guild.premiumTier, count: guild.premiumSubscriptionCount ?? 0 })],
      thumbnail: guild.iconURL({ size: 256 }),
      items: boosters.map((member) => t(lang, 'info.boosters.item', { member: `<@${member.id}>`, since: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>` })),
      footer: t(lang, 'info.boosters.footer'),
      empty: t(lang, 'info.boosters.empty'),
    };
  },
});

module.exports = {
  aliases: ['boosts'],
  data: new SlashCommandBuilder().setName('boosters').setDescription('Lists who is boosting this server and since when.'),

  async execute(interaction) {
    await sendPager(interaction, 'boosters');
  },
};
