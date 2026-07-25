/**
 * Resolves a free-form string of user mentions/IDs (space or comma separated) into
 * User objects. Used by the mass-action commands (/mban, /mkick, /mavisar, etc.),
 * which take multiple targets in a single string option since Discord slash commands
 * have no native "list of users" type.
 */
async function resolveUsers(client, input) {
  const ids = [...new Set(input.split(/[\s,]+/).filter(Boolean).map((t) => t.replace(/[<@!>]/g, '')))];

  const users = [];
  const failed = [];

  for (const id of ids) {
    const user = await client.users.fetch(id).catch(() => null);
    if (user) users.push(user);
    else failed.push(id);
  }

  return { users, failed };
}

module.exports = { resolveUsers };
