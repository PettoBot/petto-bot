const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { COLORS } = require('../../utils/colors');

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
      await interaction.reply({ content: "That user isn't in this server." });
      return;
    }

    const perms = channel.permissionsFor(member) ?? new PermissionsBitField();
    const granted = perms.toArray().map((p) => READABLE[p] ?? p);

    const embed = new EmbedBuilder()
      .setColor(COLORS.DEFAULT)
      .setTitle(`${user.username}'s permissions in #${channel.name}`)
      .setDescription(granted.length ? granted.map((p) => `\`${p}\``).join(', ') : 'No permissions.');

    await interaction.reply({ embeds: [embed] });
  },
};
