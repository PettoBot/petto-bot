const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');

/**
 * Full permission/hierarchy check for a moderation action against a target member.
 * Returns { ok: true } or { ok: false, message } — callers just need to reply
 * with `message` and stop, so every mod command gets identical, clear errors
 * instead of Discord's silent/opaque API failures.
 */
const DEFAULT_HIERARCHY = { [PermissionFlagsBits.KickMembers]: 'kick', [PermissionFlagsBits.BanMembers]: 'ban', [PermissionFlagsBits.ModerateMembers]: 'timeout' };

/**
 * Whether the bot can act on the member, judged by what Discord itself checks for that action. `moderatable` is only for timeouts
 * (it is false for anyone with the Administrator permission, even when the bot's role is above theirs), so using it for a kick
 * or a ban refused members that Discord would have let the bot remove, like a bot with an admin role.
 * `hierarchy` is 'kick', 'ban', 'timeout' or 'none' (the action does not change the member: a warning, a voice action).
 */
function botCanAct(member, hierarchy) {
  switch (hierarchy) {
    case 'kick': return member.kickable ? null : 'I cannot kick this member: their highest role is above or equal to mine, or they own the server.';
    case 'ban': return member.bannable ? null : 'I cannot ban this member: their highest role is above or equal to mine, or they own the server.';
    case 'timeout':
      if (member.moderatable) return null;
      return member.permissions?.has(PermissionFlagsBits.Administrator)
        ? 'Discord does not let anyone time out a member with the Administrator permission. Use a kick or a ban instead.'
        : 'I cannot act on this member: their highest role is above or equal to mine.';
    default: return null;
  }
}

function canModerate(interaction, targetMember, requiredPermission, { hierarchy = DEFAULT_HIERARCHY[requiredPermission] ?? 'none' } = {}) {
  const { member: moderator, guild } = interaction;
  const me = guild.members.me;

  // A server administrator can explicitly authorize a role through !moderation.
  // That role-based access only replaces the caller's Discord permission; the
  // bot permission and the normal role hierarchy checks below still apply.
  if (!moderator.permissions.has(requiredPermission) && !interaction.pettoModerationRoleAllowed) {
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

  const blocked = botCanAct(targetMember, hierarchy);
  if (blocked) return { ok: false, message: blocked };

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

module.exports = { canModerate, botCanAct };
