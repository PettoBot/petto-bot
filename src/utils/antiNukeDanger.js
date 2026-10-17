const { PermissionFlagsBits } = require('discord.js');

/**
 * The permissions a nuke needs. A role given one of them, or a channel opened to @everyone with one of them, is treated as an
 * attack at once by the protections that watch it (no need to reach the limit).
 */
const DANGEROUS_ROLE_FLAGS = [
  'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'BanMembers', 'KickMembers', 'MentionEveryone', 'ModerateMembers',
];
// A channel overwrite cannot give Administrator or ban; these are the ones that matter in a channel.
const DANGEROUS_CHANNEL_FLAGS = ['ManageChannels', 'ManageRoles', 'ManageWebhooks', 'MentionEveryone', 'ManageMessages'];

/** The dangerous permissions `after` has and `before` did not (both permission bitfields as bigint). */
function gainedFlags(before, after, names) {
  const was = BigInt(before ?? 0);
  const now = BigInt(after ?? 0);
  const admin = PermissionFlagsBits.Administrator;
  return names.filter((name) => {
    const flag = PermissionFlagsBits[name];
    if ((now & flag) !== flag) return false;
    // A role that already had Administrator had every permission, so nothing new is gained.
    return (was & flag) !== flag && (was & admin) !== admin;
  });
}

/** The overwrites of a channel as plain data, to compare and to put back. */
function overwritesOf(channel) {
  return [...(channel?.permissionOverwrites?.cache?.values() ?? [])]
    .map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { DANGEROUS_ROLE_FLAGS, DANGEROUS_CHANNEL_FLAGS, gainedFlags, overwritesOf };
