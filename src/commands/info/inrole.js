const { SlashCommandBuilder } = require('discord.js');
const { noticePayload } = require('../../utils/infoCard');
const { register, sendPager } = require('../../utils/pager');
const { t, languageOf } = require('../../i18n');

const FILTERS = ['all', 'humans', 'bots', 'newest'];

register('inrole', {
  perPage: 20,
  async load(guild, { option, arg, lang }) {
    const role = guild.roles.cache.get(arg);
    if (!role) return { items: [], title: t(lang, 'info.inrole.role'), empty: t(lang, 'info.inrole.gone') };
    let members = [...role.members.values()];
    if (option === 'humans') members = members.filter((member) => !member.user.bot);
    if (option === 'bots') members = members.filter((member) => member.user.bot);
    members.sort(option === 'newest' ? (a, b) => (b.joinedTimestamp ?? 0) - (a.joinedTimestamp ?? 0) : (a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));
    return {
      title: `${role.name} (${role.members.size})`,
      subtitle: [`<@&${role.id}>`],
      thumbnail: guild.iconURL({ size: 256 }),
      items: members.map((member) => `<@${member.id}> · ${member.user.username}`),
      options: FILTERS.map((value) => ({ label: t(lang, `info.inrole.filter.${value}.menu`), value })),
      placeholder: t(lang, 'core.pager.show.menu'),
      empty: t(lang, 'info.inrole.empty'),
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
      await interaction.reply(noticePayload(t(await languageOf(interaction), 'info.inrole.everyone', { everyone: '@everyone' })));
      return;
    }
    await sendPager(interaction, 'inrole', { arg: role.id });
  },
};
