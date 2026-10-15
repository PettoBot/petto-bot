const { SlashCommandBuilder } = require('discord.js');
const { noticePayload } = require('../../utils/infoCard');
const { register, sendPager } = require('../../utils/pager');
const { t, tn, languageOf } = require('../../i18n');

const SORTS = ['position', 'members', 'name', 'newest', 'oldest', 'colored', 'empty'];

const compare = {
  position: (a, b) => b.position - a.position,
  members: (a, b) => b.members.size - a.members.size || b.position - a.position,
  name: (a, b) => a.name.localeCompare(b.name),
  newest: (a, b) => b.createdTimestamp - a.createdTimestamp,
  oldest: (a, b) => a.createdTimestamp - b.createdTimestamp,
};

register('roles', {
  async load(guild, { option, lang }) {
    const sort = SORTS.includes(option) ? option : 'position';
    let roles = [...guild.roles.cache.filter((role) => role.id !== guild.id).values()];
    if (sort === 'colored') roles = roles.filter((role) => role.color);
    if (sort === 'empty') roles = roles.filter((role) => role.members.size === 0);
    roles.sort(compare[sort] ?? compare.position);
    return {
      title: t(lang, 'info.roles.title', { count: guild.roles.cache.size - 1 }),
      subtitle: [guild.name],
      thumbnail: guild.iconURL({ size: 256 }),
      items: roles.map((role) => tn(lang, 'info.roles.item', role.members.size, { role: `<@&${role.id}>`, count: role.members.size })),
      options: SORTS.map((value) => ({ label: t(lang, `info.roles.sort.${value}.menu`), value })),
      placeholder: t(lang, 'info.roles.placeholder.menu'),
      empty: t(lang, 'info.roles.empty'),
    };
  },
});

module.exports = {
  aliases: ['rl'],
  data: new SlashCommandBuilder().setName('roles').setDescription('Lists every role in this server, a page at a time.'),

  async execute(interaction) {
    if (guildHasNoRoles(interaction.guild)) {
      await interaction.reply(noticePayload(t(await languageOf(interaction), 'info.roles.none')));
      return;
    }
    await sendPager(interaction, 'roles');
  },
};

function guildHasNoRoles(guild) {
  return guild.roles.cache.size <= 1;
}
