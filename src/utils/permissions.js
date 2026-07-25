const { PermissionsBitField } = require('discord.js');

/**
 * Full permission/hierarchy check for a moderation action against a target member.
 * Returns { ok: true } or { ok: false, message } — callers just need to reply
 * with `message` and stop, so every mod command gets identical, clear errors
 * instead of Discord's silent/opaque API failures.
 */
function canModerate(interaction, targetMember, requiredPermission) {
  const { member: moderator, guild } = interaction;
  const me = guild.members.me;

  if (!moderator.permissions.has(requiredPermission)) {
    return { ok: false, message: `You need the **${permissionLabel(requiredPermission)}** permission to do that.` };
  }

  if (!me.permissions.has(requiredPermission)) {
    return { ok: false, message: `I need the **${permissionLabel(requiredPermission)}** permission to do that.` };
  }

  if (!targetMember) {
    // Target isn't in the guild (e.g. banning by ID) — nothing left to check.
    return { ok: true };
  }

  if (targetMember.id === interaction.user.id) {
    return { ok: false, message: 'You cannot target yourself.' };
  }

  if (targetMember.id === guild.ownerId) {
    return { ok: false, message: 'You cannot target the server owner.' };
  }

  if (targetMember.id === me.id) {
    return { ok: false, message: 'You cannot target me.' };
  }

  if (!targetMember.moderatable) {
    return { ok: false, message: 'I cannot act on this member: their highest role is above or equal to mine.' };
  }

  if (
    moderator.id !== guild.ownerId &&
    targetMember.roles.highest.position >= moderator.roles.highest.position
  ) {
    return { ok: false, message: 'You cannot target someone with a role equal to or higher than yours.' };
  }

  return { ok: true };
}

function permissionLabel(flag) {
  const entry = Object.entries(PermissionsBitField.Flags).find(([, value]) => value === flag);
  return entry ? entry[0] : String(flag);
}

module.exports = { canModerate };
