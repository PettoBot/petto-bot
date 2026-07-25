const { PermissionsBitField } = require('discord.js');

/** Turns a command's `default_member_permissions` (a decimal-string bitfield, or null) into a readable list. */
function describePermissions(rawBitfield) {
  if (rawBitfield == null) return 'Everyone';

  const bits = BigInt(rawBitfield);
  const names = [];

  for (const [name, flag] of Object.entries(PermissionsBitField.Flags)) {
    if (flag !== 0n && (bits & flag) === flag) names.push(name);
  }

  return names.length ? names.join(', ') : 'Everyone';
}

module.exports = { describePermissions };
