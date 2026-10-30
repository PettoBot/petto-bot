// Checks the ways the database is kept small: the entries of the public threat feeds that are not listed any more. Runs when PETTO_TEST_DATABASE_URL points to a test database, and is skipped otherwise.
const assert = require('node:assert/strict');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the storage trim check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
const { getPrimaryPool, closePools } = require('../src/db/postgres');
const links = require('../src/db/maliciousLinks');

(async () => {
  const pool = getPrimaryPool();
  // --- threat feeds ----------------------------------------------------------------------------------------------------------------------
  const old = "now() - interval '30 days'";
  await pool.query("delete from malicious_links where normalized_url like 'trim-check.example/%'");
  const row = (name, source, extra = {}) => pool.query(
    `insert into malicious_links (normalized_url, hostname, source, reported_by, dev_alerted_at, last_checked_at) values ($1, 'trim-check.example', $2, $3, $4, ${extra.old ? old : 'now()'})`,
    [`trim-check.example/${name}`, source, extra.reportedBy ?? null, extra.alerted ?? null]);
  await row('stale', 'openphish', { old: true });
  await row('fresh', 'openphish');
  await row('reported', 'openphish', { old: true, reportedBy: '1' });
  await row('alerted', 'openphish', { old: true, alerted: new Date().toISOString() });
  await row('other-feed', 'urlhaus', { old: true });
  assert.equal(await links.pruneStaleFeedLinks('openphish', 14), 1, 'only the old one of that feed that nobody reported goes');
  const left = (await pool.query("select normalized_url from malicious_links where normalized_url like 'trim-check.example/%' order by 1")).rows.map((r) => r.normalized_url.split('/')[1]);
  assert.deepEqual(left, ['alerted', 'fresh', 'other-feed', 'reported']);
  await pool.query("delete from malicious_links where normalized_url like 'trim-check.example/%'");

  await closePools();
  console.log('check-storage-trim: ok');
})().catch((error) => { console.error(error); process.exit(1); });
