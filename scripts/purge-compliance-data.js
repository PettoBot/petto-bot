// i18n-ignore-file: a tool for the owner, run by hand from a terminal
// Empties what the removed shop score left in the database:
//
//   - the rows of `guild_compliance_scores` (the score of each server);
//   - the "ignored" settings of the shop alerts, which are four columns of `guilds` (compliance_ignored, compliance_ignored_by, compliance_ignored_at,
//     compliance_ignore_reason): they are set back to false / null for the servers that have one.
//
// It is a dry run unless `--yes` is given: it only counts the rows and changes nothing. The table and the columns stay (nothing drops them, and schema.sql
// still makes them empty at boot), and nothing else is touched. The bot never runs this: it is the owner's decision when the stored data goes.
//
//   node scripts/purge-compliance-data.js          counts what it would delete
//   node scripts/purge-compliance-data.js --yes    deletes it
//
// Run it with the same environment as the bot (DISCLOUD_DATABASE_URL).
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const SETTINGS = "compliance_ignored or compliance_ignored_by is not null or compliance_ignored_at is not null or compliance_ignore_reason is not null";

/** Whether a table exists in the database behind `pool`. */
async function hasTable(pool, name) {
  const { rows } = await pool.query('select to_regclass($1) is not null as found', [name]);
  return rows[0].found === true;
}

/** Whether the `guilds` table still has the compliance columns. */
async function hasSettingsColumns(pool) {
  const { rows } = await pool.query("select count(*)::int as n from information_schema.columns where table_schema = current_schema() and table_name = 'guilds' and column_name like 'compliance\\_%'");
  return rows[0].n > 0;
}

/** Counts what there is to delete: { scores, settings } (0 for a table or column that does not exist). */
async function survey(pool) {
  const scores = await hasTable(pool, 'guild_compliance_scores')
    ? Number((await pool.query('select count(*)::bigint as n from guild_compliance_scores')).rows[0].n) : 0;
  const settings = await hasSettingsColumns(pool)
    ? Number((await pool.query(`select count(*)::bigint as n from guilds where ${SETTINGS}`)).rows[0].n) : 0;
  return { scores, settings };
}

/** Deletes everything `survey` counted. Returns { scores, settings } with the rows changed. */
async function purge(pool) {
  let scores = 0;
  let settings = 0;
  if (await hasTable(pool, 'guild_compliance_scores')) scores = (await pool.query('delete from guild_compliance_scores')).rowCount;
  if (await hasSettingsColumns(pool)) {
    settings = (await pool.query(`update guilds set compliance_ignored = false, compliance_ignored_by = null, compliance_ignored_at = null, compliance_ignore_reason = null where ${SETTINGS}`)).rowCount;
  }
  return { scores, settings };
}

async function main(argv) {
  const unknown = argv.filter((arg) => !['--yes', '--help', '-h'].includes(arg));
  if (unknown.length || argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node scripts/purge-compliance-data.js [--yes]\n\nWithout --yes it only counts what it would delete (a dry run).\nWith --yes it deletes the stored shop scores and resets the "ignored" settings of the shop alerts.');
    return unknown.length ? 1 : 0;
  }
  const pool = getPrimaryPool();
  try {
    const before = await survey(pool);
    console.log(`${before.scores} stored shop scores (guild_compliance_scores).`);
    console.log(`${before.settings} servers with an "ignored" setting of the shop alerts (columns compliance_* of guilds).`);
    if (!argv.includes('--yes')) {
      console.log('Dry run: nothing was deleted. Run it again with --yes to delete.');
      return 0;
    }
    const done = await purge(pool);
    console.log(`Deleted ${done.scores} scores and reset ${done.settings} settings. The table and the columns were not dropped.`);
    return 0;
  } finally {
    await closePools();
  }
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error); process.exit(1); });

module.exports = { survey, purge };
