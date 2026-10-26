// The Last.fm name each person linked to their Discord account (table lastfm_links in schema.sql).
const { getPrimaryPool } = require('./postgres');

async function getLink(userId) {
  const { rows } = await getPrimaryPool().query('select username from lastfm_links where user_id = $1', [String(userId)]);
  return rows[0]?.username ?? null;
}

async function setLink(userId, username) {
  await getPrimaryPool().query(
    `insert into lastfm_links (user_id, username) values ($1, $2)
     on conflict (user_id) do update set username = excluded.username, updated_at = now()`,
    [String(userId), username],
  );
}

/** True when there was a link to remove. */
async function removeLink(userId) {
  const { rowCount } = await getPrimaryPool().query('delete from lastfm_links where user_id = $1', [String(userId)]);
  return rowCount > 0;
}

/** The linked names of several people at once: Map of Discord id to Last.fm name. */
async function getLinks(userIds) {
  const ids = [...new Set(userIds.map(String))];
  if (!ids.length) return new Map();
  const { rows } = await getPrimaryPool().query('select user_id, username from lastfm_links where user_id = any($1::text[])', [ids]);
  return new Map(rows.map((row) => [row.user_id, row.username]));
}

module.exports = { getLink, setLink, removeLink, getLinks };
