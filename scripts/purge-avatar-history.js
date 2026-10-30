// i18n-ignore-file: a tool for the owner, run by hand from a terminal
// Deletes what the avatar history left in the databases, now that Petto no longer records avatars or copies their pictures:
//
//   - the avatar entries of the history (`identity_history` rows with kind = 'avatar'), in the main database;
//   - the avatar copies (the table `profile_history_images`), in the main database and, when there is one, in the second one (PETTO_DATA2_DATABASE_URL).
//
// It is a dry run unless `--yes` is given: it only counts the rows and the size they take, and changes nothing. Nothing else is touched: the names and
// nicknames of the history (`identity_history` rows of kind name and nickname), the opt-outs (`identity_history_optout`), `identity_audit_events` and the
// tables themselves stay, and no column is dropped. The bot never runs this: it is the owner's decision when the stored copies go.
//
//   node scripts/purge-avatar-history.js          counts what it would delete and the size it would free
//   node scripts/purge-avatar-history.js --yes    deletes it (the copies with TRUNCATE, which gives their disk space back at once; the avatar entries in batches)
//
// Run it with the same environment as the bot (DISCLOUD_DATABASE_URL, and PETTO_DATA2_DATABASE_URL if there is a second database). The disk space of
// `identity_history` itself is reused by the database but only given back to the host by `VACUUM FULL identity_history;` (it locks the table while it runs).
const { getPrimaryPool, closePools } = require('../src/db/postgres');
const secondary = require('../src/db/secondary');

const BATCH = 5_000;
const MB = 1024 * 1024;
const formatSize = (bytes) => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`);

/** Whether a table exists in the database behind `pool` (a database made after the avatar history was removed does not have the copies table). */
async function hasTable(pool, name) {
  const { rows } = await pool.query('select to_regclass($1) is not null as found', [name]);
  return rows[0].found === true;
}

/** The avatar entries of the history: how many, and about how many bytes their rows take. */
async function historyAvatars(pool) {
  const { rows } = await pool.query(`select count(*)::bigint as rows, coalesce(sum(pg_column_size(h.*)), 0)::bigint as bytes from identity_history h where kind = 'avatar'`);
  return { rows: Number(rows[0].rows), bytes: Number(rows[0].bytes) };
}

/** The avatar copies of a database: how many rows, the pictures' bytes, and what the table takes on disk (indexes and TOAST too). */
async function copiesOf(pool) {
  if (!await hasTable(pool, 'profile_history_images')) return { exists: false, rows: 0, bytes: 0, disk: 0 };
  const { rows } = await pool.query(`select count(*)::bigint as rows, coalesce(sum(size), 0)::bigint as bytes, pg_total_relation_size('profile_history_images')::bigint as disk from profile_history_images`);
  return { exists: true, rows: Number(rows[0].rows), bytes: Number(rows[0].bytes), disk: Number(rows[0].disk) };
}

/**
 * Counts what there is to delete. `places` has one entry per database: `{ label, pool, history }` (`history` only for the main one).
 * Returns the same entries with `history` ({ rows, bytes }) and `copies` ({ exists, rows, bytes, disk }).
 */
async function survey(places) {
  const out = [];
  for (const place of places) {
    out.push({ ...place, history: place.history ? await historyAvatars(place.pool) : null, copies: await copiesOf(place.pool) });
  }
  return out;
}

/** What deleting would free, in bytes: the copies' tables on disk, and the rows of the avatar entries. */
const freed = (surveyed) => surveyed.reduce((sum, place) => sum + place.copies.disk + (place.history?.bytes ?? 0), 0);

/** Deletes everything `survey` counted. Returns { history, copies } with the rows deleted. */
async function purge(places, { log = () => {} } = {}) {
  let history = 0;
  let copies = 0;
  for (const place of places) {
    // The copies first: TRUNCATE gives the space back at once. A database that has no such table has nothing to delete.
    if (await hasTable(place.pool, 'profile_history_images')) {
      const { rows } = await place.pool.query('select count(*)::bigint as rows from profile_history_images');
      await place.pool.query('truncate table profile_history_images');
      copies += Number(rows[0].rows);
      log(`${place.label}: ${rows[0].rows} avatar copies deleted.`);
    }
    if (place.history) {
      let removed;
      do {
        ({ rowCount: removed } = await place.pool.query(`delete from identity_history where id in (select id from identity_history where kind = 'avatar' limit ${BATCH})`));
        history += removed;
        if (removed) log(`${place.label}: ${history} avatar entries of the history deleted so far.`);
      } while (removed === BATCH);
    }
  }
  return { history, copies };
}

/** The databases to look at: the main one (with the history) and, when there is one, the second one. */
function placesFor() {
  const places = [{ label: 'main database', pool: getPrimaryPool(), history: true }];
  if (secondary.isSeparate()) places.push({ label: 'second database', pool: secondary.pool, history: false });
  return places;
}

function describe(surveyed) {
  const lines = [];
  for (const place of surveyed) {
    if (place.history) lines.push(`${place.label}: ${place.history.rows} avatar entries in the history (about ${formatSize(place.history.bytes)}).`);
    lines.push(place.copies.exists
      ? `${place.label}: ${place.copies.rows} avatar copies (${formatSize(place.copies.bytes)} of pictures, ${formatSize(place.copies.disk)} on disk with its indexes).`
      : `${place.label}: no table of avatar copies.`);
  }
  return lines;
}

async function main(argv) {
  const known = new Set(['--yes', '--help', '-h']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length || argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node scripts/purge-avatar-history.js [--yes]\n\nWithout --yes it only counts what it would delete and the size it would free (a dry run).\nWith --yes it deletes the avatar entries of the history and the avatar copies, in the main and the second database.\nIt never touches the names and nicknames of the history.');
    return unknown.length ? 1 : 0;
  }
  const apply = argv.includes('--yes');
  const places = placesFor();
  try {
    const before = await survey(places);
    for (const line of describe(before)) console.log(line);
    console.log(`It would free about ${formatSize(freed(before))}.`);
    if (!apply) {
      console.log('Dry run: nothing was deleted. Run it again with --yes to delete.');
      return 0;
    }
    const done = await purge(places, { log: (line) => console.log(line) });
    console.log(`Deleted ${done.history} avatar entries of the history and ${done.copies} avatar copies. Names, nicknames and opt-outs were not touched.`);
    console.log('To give the space of identity_history back to the host, run VACUUM FULL identity_history; (it locks the table while it runs).');
    return 0;
  } finally {
    await secondary.closeSecondary();
    await closePools();
  }
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error); process.exit(1); });

module.exports = { survey, purge, describe, freed, hasTable };
