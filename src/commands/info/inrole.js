const { SlashCommandBuilder } = require('discord.js');
const { noticePayload } = require('../../utils/infoCard');
const { register, sendPager } = require('../../utils/pager');

const FILTERS = [
  { label: 'Everyone with the role', value: 'all' },
  { label: 'People only', value: 'humans' },
  { label: 'Bots only', value: 'bots' },
  { label: 'Newest members first', value: 'newest' },
];

register('inrole', {
  perPage: 20,
  async load(guild, { option, arg }) {
    const role = guild.roles.cache.get(arg);
    if (!role) return { items: [], title: 'Role', empty: 'That role no longer exists.' };
    let members = [...role.members.values()];
    if (option === 'humans') members = members.filter((member) => !member.user.bot);
    if (option === 'bots') members = members.filter((member) => member.user.bot);
    members.sort(option === 'newest' ? (a, b) => (b.joinedTimestamp ?? 0) - (a.joinedTimestamp ?? 0) : (a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));
    return {
      title: `${role.name} (${role.members.size})`,
      subtitle: [`<@&${role.id}>`],
      thumbnail: guild.iconURL({ size: 256 }),
      items: members.map((member) => `<@${member.id}> · ${member.user.username}`),
      options: FILTERS,
      placeholder: 'Show…',
      empty: 'Nobody with that role matches.',
    };
  },
});

module.exports = {
  aliases: ['ir', 'members'],
  data: new SlashCommandBuilder()
    .setName('inrole')
    .setDescription('Lists the members that have a role, a page at a time.')
    .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),

  async execute(interaction) {
    const role = interaction.options.getRole('role', true);
    if (role.id === interaction.guild.id) {
      await interaction.reply(noticePayload('Everyone has @everyone. Pick another role.'));
      return;
    }
    await sendPager(interaction, 'inrole', { arg: role.id });
  },
};
