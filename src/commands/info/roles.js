const { SlashCommandBuilder } = require('discord.js');
const { noticePayload } = require('../../utils/infoCard');
const { register, sendPager } = require('../../utils/pager');

const SORTS = [
  { label: 'Highest role first', value: 'position' },
  { label: 'Most members', value: 'members' },
  { label: 'Name (A–Z)', value: 'name' },
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Only roles with a color', value: 'colored' },
  { label: 'Only roles without members', value: 'empty' },
];

const compare = {
  position: (a, b) => b.position - a.position,
  members: (a, b) => b.members.size - a.members.size || b.position - a.position,
  name: (a, b) => a.name.localeCompare(b.name),
  newest: (a, b) => b.createdTimestamp - a.createdTimestamp,
  oldest: (a, b) => a.createdTimestamp - b.createdTimestamp,
};

register('roles', {
  async load(guild, { option }) {
    const sort = SORTS.some((entry) => entry.value === option) ? option : 'position';
    let roles = [...guild.roles.cache.filter((role) => role.id !== guild.id).values()];
    if (sort === 'colored') roles = roles.filter((role) => role.color);
    if (sort === 'empty') roles = roles.filter((role) => role.members.size === 0);
    roles.sort(compare[sort] ?? compare.position);
    return {
      title: `Roles (${guild.roles.cache.size - 1})`,
      subtitle: [guild.name],
      thumbnail: guild.iconURL({ size: 256 }),
      items: roles.map((role) => `<@&${role.id}> · ${role.members.size} ${role.members.size === 1 ? 'member' : 'members'}`),
      options: SORTS,
      placeholder: 'Sort or filter the roles',
      empty: 'No role matches that filter.',
    };
  },
});

module.exports = {
  aliases: ['rl'],
  data: new SlashCommandBuilder().setName('roles').setDescription('Lists every role in this server, a page at a time.'),

  async execute(interaction) {
    if (guildHasNoRoles(interaction.guild)) {
      await interaction.reply(noticePayload('This server has no roles.'));
      return;
    }
    await sendPager(interaction, 'roles');
  },
};

function guildHasNoRoles(guild) {
  return guild.roles.cache.size <= 1;
}
