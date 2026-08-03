const { PermissionsBitField } = require('discord.js');

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

/** Turns a command's `default_member_permissions` (a decimal-string bitfield, or null) into a readable list. */
function describePermissions(rawBitfield) {
  if (rawBitfield == null) return 'Everyone';

  const bits = BigInt(rawBitfield);
  const names = [];

  for (const [name, flag] of Object.entries(PermissionsBitField.Flags)) {
    if (flag !== 0n && (bits & flag) === flag) names.push(READABLE[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2'));
  }

  return names.length ? names.join(', ') : 'Everyone';
}

module.exports = { describePermissions };
