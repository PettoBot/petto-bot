const { PermissionsBitField } = require('discord.js');
const { t, currentLanguage } = require('../i18n');

// The name of each permission is in the catalogs, as `core.perm.<flag>` (English: "Ban Members").
/** Turns a command's `default_member_permissions` (a decimal-string bitfield, or null) into a readable list. */
function describePermissions(rawBitfield, lang = currentLanguage()) {
  if (rawBitfield == null) return t(lang, 'core.perm.everyone');

  const bits = BigInt(rawBitfield);
  const names = [];

  for (const [name, flag] of Object.entries(PermissionsBitField.Flags)) {
    if (flag !== 0n && (bits & flag) === flag) names.push(permissionName(name, lang));
  }

  return names.length ? names.join(', ') : t(lang, 'core.perm.everyone');
}

/** The name people read for one permission flag (`BanMembers` -> "Ban Members", "Banear miembros"). */
function permissionName(flag, lang = currentLanguage()) {
  const key = `core.perm.${flag}`;
  const text = t(lang, key);
  return text !== key ? text : flag.replace(/([a-z])([A-Z])/g, '$1 $2');
}

module.exports = { describePermissions, permissionName };
