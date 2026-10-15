const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { INFO_ACCENT, infoPayload, noticePayload, line } = require('../../utils/infoCard');
const { t, tn, languageOf } = require('../../i18n');

// The catalog key of each group's title and the permissions in it.
const GROUPS = [
  ['info.permissions.group.server', ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'ManageGuildExpressions', 'ManageEvents', 'ViewAuditLog', 'ViewGuildInsights', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageNicknames', 'ChangeNickname', 'CreateInstantInvite']],
  ['info.permissions.group.text', ['ViewChannel', 'SendMessages', 'SendTTSMessages', 'EmbedLinks', 'AttachFiles', 'AddReactions', 'UseExternalEmojis', 'MentionEveryone', 'ReadMessageHistory', 'ManageMessages', 'ManageThreads']],
  ['info.permissions.group.voice', ['Connect', 'Speak', 'Stream', 'UseVAD', 'PrioritySpeaker', 'MuteMembers', 'DeafenMembers', 'MoveMembers']],
];

/** The name of a permission as people know it (the shared `core.perm.*` names), or its flag when it has none. */
function readable(name, lang) {
  const key = `core.perm.${name}`;
  const text = t(lang, key);
  return text === key ? name : text;
}

function chips(names, lang) {
  return names.map((name) => `\`${readable(name, lang)}\``).join(' · ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('permissions')
    .setDescription("Shows a member's effective permissions in a channel.")
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)').setRequired(false)),
  aliases: ['perms'],

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const user = interaction.options.getUser('user') ?? interaction.user;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const member = interaction.guild.members.cache.get(user.id) ?? (await interaction.guild.members.fetch(user.id).catch(() => null));

    if (!member) {
      await interaction.reply(noticePayload(t(lang, 'info.permissions.notMember')));
      return;
    }

    const perms = channel.permissionsFor(member) ?? new PermissionsBitField();
    const granted = perms.toArray();
    const known = new Set(GROUPS.flatMap(([, names]) => names));

    const sections = GROUPS
      .map(([title, names]) => ({ title: t(lang, title), lines: [chips(names.filter((name) => granted.includes(name)), lang)] }))
      .filter((section) => section.lines[0]);
    const other = granted.filter((name) => !known.has(name));
    if (other.length) sections.push({ title: t(lang, 'info.permissions.group.others'), lines: [chips(other, lang)] });
    if (!sections.length) sections.push({ lines: [t(lang, 'info.permissions.none')] });

    await interaction.reply(infoPayload({
      accent: member.displayColor || INFO_ACCENT,
      title: t(lang, 'info.permissions.title', { name: member.displayName }),
      thumbnail: member.displayAvatarURL({ size: 256 }),
      subtitle: [
        line(t(lang, 'info.label.channel'), `<#${channel.id}>`),
        perms.has(PermissionsBitField.Flags.Administrator) ? t(lang, 'info.permissions.admin') : tn(lang, 'info.permissions.granted', granted.length, { count: granted.length }),
      ],
      sections,
      footer: t(lang, 'info.card.id', { id: user.id }),
    }));
  },
};
