const { SlashCommandBuilder } = require('discord.js');
const { register, sendPager } = require('../../utils/pager');
const { t } = require('../../i18n');

const FILTERS = ['all', 'static', 'animated'];

register('emojis', {
  perPage: 20,
  async load(guild, { option, lang }) {
    let emojis = [...guild.emojis.cache.values()];
    if (option === 'static') emojis = emojis.filter((emoji) => !emoji.animated);
    if (option === 'animated') emojis = emojis.filter((emoji) => emoji.animated);
    emojis.sort((a, b) => a.name.localeCompare(b.name));
    return {
      title: t(lang, 'info.emojis.title', { count: guild.emojis.cache.size }),
      subtitle: [guild.name],
      thumbnail: guild.iconURL({ size: 256 }),
      items: emojis.map((emoji) => `${emoji} \`:${emoji.name}:\``),
      options: FILTERS.map((value) => ({ label: t(lang, `info.emojis.filter.${value}.menu`), value })),
      placeholder: t(lang, 'core.pager.show.menu'),
      empty: t(lang, 'info.emojis.empty'),
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
