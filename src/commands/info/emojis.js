const { SlashCommandBuilder } = require('discord.js');
const { register, sendPager } = require('../../utils/pager');

const FILTERS = [
  { label: 'All emojis', value: 'all' },
  { label: 'Still emojis', value: 'static' },
  { label: 'Animated emojis', value: 'animated' },
];

register('emojis', {
  perPage: 20,
  async load(guild, { option }) {
    let emojis = [...guild.emojis.cache.values()];
    if (option === 'static') emojis = emojis.filter((emoji) => !emoji.animated);
    if (option === 'animated') emojis = emojis.filter((emoji) => emoji.animated);
    emojis.sort((a, b) => a.name.localeCompare(b.name));
    return {
      title: `Emojis (${guild.emojis.cache.size})`,
      subtitle: [guild.name],
      thumbnail: guild.iconURL({ size: 256 }),
      items: emojis.map((emoji) => `${emoji} \`:${emoji.name}:\``),
      options: FILTERS,
      placeholder: 'Show…',
      empty: 'This server has no emojis of that kind.',
    };
  },
});

module.exports = {
  aliases: ['emojilist', 'emotes'],
  data: new SlashCommandBuilder().setName('emojis').setDescription('Lists the custom emojis of this server, a page at a time.'),

  async execute(interaction) {
    await sendPager(interaction, 'emojis');
  },
};
