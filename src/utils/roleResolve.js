/**
 * Parses a free-form string of role mentions/IDs/names (space or comma separated) into
 * resolved guild Role objects. Used by /darol and /quitarol, which take multiple roles
 * in a single string option since Discord slash commands have no native "list of roles" type.
 */
function resolveRole(guild, query) {
  if (!query) return null;
  const token = String(query).trim();
  const id = token.replace(/[<@&>]/g, '');
  if (/^\d{15,25}$/.test(id)) return guild.roles.cache.get(id) ?? null;

  const q = token.toLowerCase();
  const roles = [...guild.roles.cache.values()];
  return roles.find((r) => r.name.toLowerCase() === q)
    ?? roles.find((r) => r.name.toLowerCase().startsWith(q))
    ?? roles.find((r) => r.name.toLowerCase().includes(q))
    ?? null;
}

function resolveRoles(guild, input) {
  const tokens = input.split(/[\s,]+/).filter(Boolean);
  const resolved = [];
  const unresolved = [];

  for (const token of tokens) {
    const role = resolveRole(guild, token);
    if (role) resolved.push(role);
    else unresolved.push(token);
  }

  return { resolved, unresolved };
}

/**
 * Splits resolved roles into ones the moderator+bot are actually allowed to add/remove
 * (below both their highest roles, and not integration-managed) vs blocked ones.
 */
function filterAssignableRoles(interaction, roles) {
  const { member: moderator, guild } = interaction;
  const me = guild.members.me;
  const isOwner = moderator.id === guild.ownerId;

  const assignable = [];
  const blocked = [];

  for (const role of roles) {
    if (role.managed || role.id === guild.id) {
      blocked.push(`${role} (managed by an integration)`);
    } else if (role.position >= me.roles.highest.position) {
      blocked.push(`${role} (above my highest role)`);
    } else if (!isOwner && role.position >= moderator.roles.highest.position) {
      blocked.push(`${role} (above your highest role)`);
    } else {
      assignable.push(role);
    }
  }

  return { assignable, blocked };
}

module.exports = { resolveRole, resolveRoles, filterAssignableRoles };
