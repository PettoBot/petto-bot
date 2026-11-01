const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { t, currentLanguage } = require('../i18n');

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
function botCanAct(member, hierarchy, lang = currentLanguage()) {
  switch (hierarchy) {
    case 'kick': return member.kickable ? null : t(lang, 'core.moderate.cannotKick');
    case 'ban': return member.bannable ? null : t(lang, 'core.moderate.cannotBan');
    case 'timeout':
      if (member.moderatable) return null;
      return member.permissions?.has(PermissionFlagsBits.Administrator)
        ? t(lang, 'core.moderate.adminTimeout')
        : t(lang, 'core.moderate.cannotAct');
    default: return null;
  }
}

function canModerate(interaction, targetMember, requiredPermission, { hierarchy = DEFAULT_HIERARCHY[requiredPermission] ?? 'none', lang = interaction.pettoLang ?? currentLanguage() } = {}) {
  const { member: moderator, guild } = interaction;
  const me = guild.members.me;

  // A server administrator can explicitly authorize a role through !moderation.
  // That role-based access only replaces the caller's Discord permission; the
  // bot permission and the normal role hierarchy checks below still apply.
  if (!moderator.permissions.has(requiredPermission) && !interaction.pettoModerationRoleAllowed) {
    return { ok: false, message: t(lang, 'core.moderate.youNeed', { permission: permissionLabel(requiredPermission, lang) }) };
  }

  if (!me.permissions.has(requiredPermission)) {
    return { ok: false, message: t(lang, 'core.moderate.iNeed', { permission: permissionLabel(requiredPermission, lang) }) };
  }

  if (!targetMember) {
    // Target isn't in the guild (e.g. banning by ID) — nothing left to check.
    return { ok: true };
  }

  if (targetMember.id === interaction.user.id) {
    return { ok: false, message: t(lang, 'core.moderate.self') };
  }

  if (targetMember.id === guild.ownerId) {
    return { ok: false, message: t(lang, 'core.moderate.owner') };
  }

  if (targetMember.id === me.id) {
    return { ok: false, message: t(lang, 'core.moderate.me') };
  }

  const blocked = botCanAct(targetMember, hierarchy, lang);
  if (blocked) return { ok: false, message: blocked };

  if (
    moderator.id !== guild.ownerId &&
    targetMember.roles.highest.position >= moderator.roles.highest.position
  ) {
    return { ok: false, message: t(lang, 'core.moderate.higherRole') };
  }

  return { ok: true };
}

// English keeps the name of the flag (`BanMembers`) as it always showed it; the other languages show the name Discord uses.
function permissionLabel(flag, lang = 'en') {
  const entry = Object.entries(PermissionsBitField.Flags).find(([, value]) => value === flag);
  if (!entry) return String(flag);
  return lang === 'en' ? entry[0] : t(lang, `core.perm.${entry[0]}`);
}

/** The names of the permissions in a bit field (`BanMembers`, or one Discord name per language), joined for a message. */
function permissionLabels(bits, lang = 'en') {
  const wanted = BigInt(bits);
  return Object.values(PermissionFlagsBits).filter((flag) => (wanted & flag) === flag && flag !== 0n).map((flag) => permissionLabel(flag, lang)).join(', ');
}

module.exports = { canModerate, botCanAct, permissionLabels };
