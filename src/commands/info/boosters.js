const { SlashCommandBuilder } = require('discord.js');
const { register, sendPager } = require('../../utils/pager');

register('boosters', {
  async load(guild) {
    const boosters = [...guild.members.cache.filter((member) => member.premiumSinceTimestamp).values()]
      .sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp);
    return {
      title: `Boosters (${boosters.length})`,
      subtitle: [`${guild.name} · level ${guild.premiumTier} · ${guild.premiumSubscriptionCount ?? 0} boosts`],
      thumbnail: guild.iconURL({ size: 256 }),
      items: boosters.map((member) => `<@${member.id}> · since <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`),
      footer: 'Oldest boost first',
      empty: 'Nobody is boosting this server right now.',
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
