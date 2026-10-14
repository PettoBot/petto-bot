const { PermissionFlagsBits: P } = require('discord.js');

// What the owner of a temporary room may be given. The first two are what owners always had.
const OWNER_PERMISSIONS = {
  manage_channels: P.ManageChannels,
  move_members: P.MoveMembers,
  manage_permissions: P.ManageRoles,
  mute_members: P.MuteMembers,
  deafen_members: P.DeafenMembers,
  priority_speaker: P.PrioritySpeaker,
};
const DEFAULT_OWNER_PERMISSIONS = ['manage_channels', 'move_members'];
const PRIVACY_MODES = ['public', 'locked', 'hidden'];

function ownerPermissionList(config) {
  const list = Array.isArray(config?.owner_permissions) ? config.owner_permissions : DEFAULT_OWNER_PERMISSIONS;
  return list.filter((name) => name in OWNER_PERMISSIONS);
}

function privacyMode(config) {
  return PRIVACY_MODES.includes(config?.privacy_mode) ? config.privacy_mode : 'public';
}

/** Adds permission bits to an overwrite list, merging into one that already exists for the same id. */
function merge(map, id, type, allow = 0n, deny = 0n) {
  const entry = map.get(id) ?? { id, type, allow: 0n, deny: 0n };
  // What is allowed now is no longer denied and the other way around, so the last word wins.
  entry.allow = (entry.allow | allow) & ~deny;
  entry.deny = (entry.deny | deny) & ~allow;
  map.set(id, entry);
}

/**
 * The permission overwrites of a new temporary room.
 * Optionally starts from the category's own overwrites (the roles of a category then work inside the room), then applies
 * the access roles and the privacy mode to @everyone, and finally gives the owner their permissions.
 */
function buildOverwrites({ guild, config, ownerId, parent = null, syncCategory = true }) {
  const map = new Map();
  let syncedFromCategory = false;
  if (syncCategory && config?.sync_category_permissions && parent?.permissionOverwrites?.cache) {
    for (const overwrite of parent.permissionOverwrites.cache.values()) {
      syncedFromCategory = true;
      map.set(overwrite.id, { id: overwrite.id, type: overwrite.type, allow: BigInt(overwrite.allow.bitfield ?? overwrite.allow), deny: BigInt(overwrite.deny.bitfield ?? overwrite.deny) });
    }
  }
  const everyone = guild.roles.everyone.id;
  const accessRoles = Array.isArray(config?.access_role_ids) ? config.access_role_ids.filter(Boolean) : [];
  const mode = privacyMode(config);
  if (accessRoles.length) {
    // Only the access roles may see and join; the privacy mode then only matters for who may speak up inside.
    merge(map, everyone, 0, 0n, P.ViewChannel | P.Connect);
    for (const roleId of accessRoles) merge(map, roleId, 0, P.ViewChannel | P.Connect, 0n);
  } else if (mode === 'public') {
    // With the category copied, public leaves @everyone as the category has it, so roles that gate the category keep gating the room.
    if (!syncedFromCategory) merge(map, everyone, 0, P.Connect, 0n);
  }
  else if (mode === 'locked') merge(map, everyone, 0, P.ViewChannel, P.Connect);
  else merge(map, everyone, 0, 0n, P.ViewChannel | P.Connect);
  let ownerAllow = P.Connect | P.ViewChannel;
  for (const name of ownerPermissionList(config)) ownerAllow |= OWNER_PERMISSIONS[name];
  merge(map, ownerId, 1, ownerAllow, 0n);
  return [...map.values()];
}

/** The lock and hidden flags a new room starts with, so the panel buttons tell the truth. */
function startingFlags(config) {
  const mode = privacyMode(config);
  return { is_locked: mode !== 'public', is_ghosted: mode === 'hidden' };
}

module.exports = { OWNER_PERMISSIONS, DEFAULT_OWNER_PERMISSIONS, PRIVACY_MODES, ownerPermissionList, privacyMode, buildOverwrites, startingFlags };
