// Restricted commands (!restrictcommand): a command with rows here can only be used by members with one of the roles.
const { getPrimaryPool } = require('./postgres');
const { createExpiringCache } = require('../utils/expiringCache');

// Read on every command, so the rules of a server stay in memory for a while.
const cache = createExpiringCache(5 * 60 * 1000);

async function listRestrictions(guildId) {
  const { rows } = await getPrimaryPool().query('select command, role_id from command_restrictions where guild_id = $1 order by command, created_at', [String(guildId)]);
  return rows;
}

/** command -> [role ids] for the server, from the cache. */
async function restrictionMap(guildId) {
  return cache.get(guildId, async () => {
    const map = {};
    for (const row of await listRestrictions(guildId)) (map[row.command] ??= []).push(row.role_id);
    return map;
  });
}

async function addRestriction(guildId, command, roleId, createdBy) {
  const { rowCount } = await getPrimaryPool().query(
    'insert into command_restrictions (guild_id, command, role_id, created_by) values ($1, $2, $3, $4) on conflict do nothing',
    [String(guildId), command, String(roleId), createdBy ? String(createdBy) : null],
  );
  cache.delete(guildId);
  return rowCount > 0;
}

async function removeRestriction(guildId, command, roleId = null) {
  const { rowCount } = roleId
    ? await getPrimaryPool().query('delete from command_restrictions where guild_id = $1 and command = $2 and role_id = $3', [String(guildId), command, String(roleId)])
    : await getPrimaryPool().query('delete from command_restrictions where guild_id = $1 and command = $2', [String(guildId), command]);
  cache.delete(guildId);
  return rowCount;
}

async function clearRestrictions(guildId) {
  const { rowCount } = await getPrimaryPool().query('delete from command_restrictions where guild_id = $1', [String(guildId)]);
  cache.delete(guildId);
  return rowCount;
}

module.exports = { listRestrictions, restrictionMap, addRestriction, removeRestriction, clearRestrictions };
