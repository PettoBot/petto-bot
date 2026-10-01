const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { INFO_ACCENT, infoPayload, noticePayload, line } = require('../../utils/infoCard');

const READABLE = {
  CreateInstantInvite: 'Create Invite', KickMembers: 'Kick Members', BanMembers: 'Ban Members', Administrator: 'Administrator',
  ManageChannels: 'Manage Channels', ManageGuild: 'Manage Server', AddReactions: 'Add Reactions', ViewAuditLog: 'View Audit Log',
  PrioritySpeaker: 'Priority Speaker', Stream: 'Video', ViewChannel: 'View Channel', SendMessages: 'Send Messages',
  SendTTSMessages: 'Send TTS Messages', ManageMessages: 'Manage Messages', EmbedLinks: 'Embed Links', AttachFiles: 'Attach Files',
  ReadMessageHistory: 'Read Message History', MentionEveryone: 'Mention Everyone', UseExternalEmojis: 'Use External Emojis',
  ViewGuildInsights: 'View Server Insights', Connect: 'Connect', Speak: 'Speak', MuteMembers: 'Mute Members',
  DeafenMembers: 'Deafen Members', MoveMembers: 'Move Members', UseVAD: 'Use Voice Activity', ChangeNickname: 'Change Nickname',
  ManageNicknames: 'Manage Nicknames', ManageRoles: 'Manage Roles', ManageWebhooks: 'Manage Webhooks',
  ManageGuildExpressions: 'Manage Expressions', ManageEvents: 'Manage Events', ManageThreads: 'Manage Threads',
  ModerateMembers: 'Timeout Members',
};

const GROUPS = [
  ['Server', ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'ManageGuildExpressions', 'ManageEvents', 'ViewAuditLog', 'ViewGuildInsights', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageNicknames', 'ChangeNickname', 'CreateInstantInvite']],
  ['Text', ['ViewChannel', 'SendMessages', 'SendTTSMessages', 'EmbedLinks', 'AttachFiles', 'AddReactions', 'UseExternalEmojis', 'MentionEveryone', 'ReadMessageHistory', 'ManageMessages', 'ManageThreads']],
  ['Voice', ['Connect', 'Speak', 'Stream', 'UseVAD', 'PrioritySpeaker', 'MuteMembers', 'DeafenMembers', 'MoveMembers']],
];

function chips(names) {
  return names.map((name) => `\`${READABLE[name] ?? name}\``).join(' · ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('permissions')
    .setDescription("Shows a member's effective permissions in a channel.")
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)').setRequired(false)),
  aliases: ['perms'],

  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const member = interaction.guild.members.cache.get(user.id) ?? (await interaction.guild.members.fetch(user.id).catch(() => null));

    if (!member) {
      await interaction.reply(noticePayload("That user isn't in this server."));
      return;
    }

    const perms = channel.permissionsFor(member) ?? new PermissionsBitField();
    const granted = perms.toArray();
    const known = new Set(GROUPS.flatMap(([, names]) => names));

    const sections = GROUPS
      .map(([title, names]) => ({ title, lines: [chips(names.filter((name) => granted.includes(name)))] }))
      .filter((section) => section.lines[0]);
    const other = granted.filter((name) => !known.has(name));
    if (other.length) sections.push({ title: 'Other', lines: [chips(other)] });
    if (!sections.length) sections.push({ lines: ['No permissions.'] });

    await interaction.reply(infoPayload({
      accent: member.displayColor || INFO_ACCENT,
      title: `${member.displayName}'s permissions`,
      thumbnail: member.displayAvatarURL({ size: 256 }),
      subtitle: [
        line('Channel', `<#${channel.id}>`),
        perms.has(PermissionsBitField.Flags.Administrator) ? 'Administrator: has every permission.' : `${granted.length} permissions granted`,
      ],
      sections,
      footer: `ID ${user.id}`,
    }));
  },
};
