// i18n-ignore-file: SQL only, no text anybody reads
// Moves the heavy tables from the main database to the second one (db/secondary.js), a piece at a time: each piece is written in the second database
// first and only then deleted from the main one, so a stop in the middle loses nothing and the next pass goes on. A row the second database already
// has is not overwritten (what is there is newer).
const { getPrimaryPool } = require('./postgres');
const secondary = require('./secondary');

const TABLES = {
  malicious_links: { key: 'normalized_url', order: 'normalized_url' },
  profile_history_images: { key: null, order: 'user_id, hash' }, // key is (user_id, hash)
};

/** Moves up to `limit` rows of `table`. Returns how many. */
async function movePiece(table, limit) {
  const info = TABLES[table];
  if (!info) throw new Error('Unknown table');
  await secondary.ready();
  const main = getPrimaryPool();
  const { rows } = await main.query(`select coalesce(json_agg(t), '[]'::json) as rows from (select * from ${table} order by ${info.order} limit $1) t`, [limit]);
  const piece = rows[0].rows;
  if (!piece.length) return 0;
  await secondary.pool.query(`insert into ${table} select * from json_populate_recordset(null::${table}, $1::json) on conflict do nothing`, [JSON.stringify(piece)]);
  if (table === 'malicious_links') await main.query('delete from malicious_links where normalized_url = any($1::text[])', [piece.map((row) => row.normalized_url)]);
  else await main.query('delete from profile_history_images where (user_id, hash) in (select * from unnest($1::text[], $2::text[]))', [piece.map((row) => row.user_id), piece.map((row) => row.hash)]);
  return piece.length;
}

/** True while the main database still has rows of the heavy tables. */
async function pending() {
  const main = getPrimaryPool();
  for (const table of Object.keys(TABLES)) {
    const { rows } = await main.query(`select exists (select 1 from ${table}) as any`);
    if (rows[0].any) return true;
  }
  return false;
}

module.exports = { movePiece, pending, TABLES };
