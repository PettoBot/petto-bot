// Forced nicknames: the nickname Petto keeps putting back on a member (!nickname force).
const { getPrimaryPool } = require('./postgres');
const { createExpiringCache } = require('../utils/expiringCache');

// Every member update of a server reads this, so the forced nicknames of a server are kept in memory for a while.
const cache = createExpiringCache(5 * 60 * 1000);

async function listForced(guildId) {
  const { rows } = await getPrimaryPool().query('select user_id, nickname, set_by, created_at from forced_nicknames where guild_id = $1 order by created_at desc', [String(guildId)]);
  return rows;
}

/** user id -> nickname for the server, from the cache. */
async function forcedMap(guildId) {
  return cache.get(guildId, async () => Object.fromEntries((await listForced(guildId)).map((row) => [row.user_id, row.nickname])));
}

async function getForced(guildId, userId) {
  const map = await forcedMap(guildId);
  return map[String(userId)] ?? null;
}

async function setForced(guildId, userId, nickname, setBy) {
  await getPrimaryPool().query(
    `insert into forced_nicknames (guild_id, user_id, nickname, set_by) values ($1, $2, $3, $4)
     on conflict (guild_id, user_id) do update set nickname = excluded.nickname, set_by = excluded.set_by, created_at = now()`,
    [String(guildId), String(userId), nickname, String(setBy)],
  );
  cache.delete(guildId);
}

async function removeForced(guildId, userId) {
  const { rowCount } = await getPrimaryPool().query('delete from forced_nicknames where guild_id = $1 and user_id = $2', [String(guildId), String(userId)]);
  cache.delete(guildId);
  return rowCount > 0;
}

module.exports = { listForced, forcedMap, getForced, setForced, removeForced };
