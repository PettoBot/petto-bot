// Temporary roles: given with !role temp, taken away by the expiry job when the time is up.
const { getPrimaryPool } = require('./postgres');

async function addTempRole(guildId, userId, roleId, setBy, expiresAt) {
  await getPrimaryPool().query(
    `insert into temp_roles (guild_id, user_id, role_id, set_by, expires_at) values ($1, $2, $3, $4, $5)
     on conflict (guild_id, user_id, role_id) do update set set_by = excluded.set_by, expires_at = excluded.expires_at, created_at = now()`,
    [String(guildId), String(userId), String(roleId), String(setBy), expiresAt],
  );
}

async function listTempRoles(guildId) {
  const { rows } = await getPrimaryPool().query('select * from temp_roles where guild_id = $1 order by expires_at asc', [String(guildId)]);
  return rows;
}

async function removeTempRole(guildId, userId, roleId) {
  const { rowCount } = await getPrimaryPool().query('delete from temp_roles where guild_id = $1 and user_id = $2 and role_id = $3', [String(guildId), String(userId), String(roleId)]);
  return rowCount > 0;
}

/** The temporary roles whose time is up, oldest first, a few at a time. */
async function getExpiredTempRoles(limit = 100) {
  const { rows } = await getPrimaryPool().query('select * from temp_roles where expires_at <= now() order by expires_at asc limit $1', [limit]);
  return rows;
}

module.exports = { addTempRole, listTempRoles, removeTempRole, getExpiredTempRoles };
