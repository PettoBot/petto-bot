// Join passes (!automod join-pass): one account may join once without the anti-raid checks stopping it.
const { getPrimaryPool } = require('./postgres');

async function addPass(guildId, userId, createdBy) {
  await getPrimaryPool().query(
    'insert into join_passes (guild_id, user_id, created_by) values ($1, $2, $3) on conflict (guild_id, user_id) do update set created_by = excluded.created_by, created_at = now()',
    [String(guildId), String(userId), String(createdBy)],
  );
}

async function removePass(guildId, userId) {
  const { rowCount } = await getPrimaryPool().query('delete from join_passes where guild_id = $1 and user_id = $2', [String(guildId), String(userId)]);
  return rowCount > 0;
}

async function listPasses(guildId) {
  const { rows } = await getPrimaryPool().query('select user_id, created_by, created_at from join_passes where guild_id = $1 order by created_at desc', [String(guildId)]);
  return rows;
}

async function hasPass(guildId, userId) {
  const { rows } = await getPrimaryPool().query('select 1 from join_passes where guild_id = $1 and user_id = $2', [String(guildId), String(userId)]);
  return rows.length > 0;
}

module.exports = { addPass, removePass, listPasses, hasPass };
