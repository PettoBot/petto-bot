// Checks the second database (PETTO_DATA2_DATABASE_URL) for the heavy data: the tables are made there, what the main database already has of the threat
// lists is moved over without losing anything, and new threat links go to the second one. The avatar copies of the old profile history are not made or moved
// there any more. The second database is a schema of the test database here (search_path), which is the same thing for the code. Runs when
// PETTO_TEST_DATABASE_URL is set.
const assert = require('node:assert/strict');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the second database check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
delete process.env.PETTO_DATA2_DATABASE_URL;
const config = require('../src/config');
const secondary = require('../src/db/secondary');
const dataMove = require('../src/db/dataMove');
const links = require('../src/db/maliciousLinks');
const { moveStep } = require('../src/jobs/dataMoveJob');
const { getPrimaryPool, closePools } = require('../src/db/postgres');


(async () => {
  const main = getPrimaryPool();
  await main.query('drop schema if exists data2 cascade');
  await main.query('create schema data2');
  const clean = async () => {
    await main.query("delete from public.malicious_links where normalized_url like 'data2-check.example/%'");
  };
  await clean();
  const seeAll = async (schema, table, where) => Number((await main.query(`select count(*) from ${schema}.${table} where ${where}`)).rows[0].count);
  const mineLinks = "normalized_url like 'data2-check.example/%'";

  // The main database already has the links (as it did before the second database).
  for (const name of ['a', 'b', 'c']) await main.query("insert into public.malicious_links (normalized_url, hostname, source, reported_by) values ($1, 'data2-check.example', 'user_report', 'x')", [`data2-check.example/${name}`]);

  // With a second database the tables are made there, and nothing is lost while the rest is moved. The avatar copies are not made there.
  config.data2DatabaseUrl = `${url}${url.includes('?') ? '&' : '?'}options=-csearch_path%3Ddata2`;
  assert.equal(secondary.isSeparate(), true);
  await secondary.ready();
  assert.equal(await seeAll('data2', 'malicious_links', mineLinks), 0, 'the second database starts empty');
  assert.equal((await main.query(`select to_regclass('data2.profile_history_images') as found`)).rows[0].found, null, 'the avatar copies table is not made in the second database');
  assert.deepEqual(Object.keys(dataMove.TABLES), ['malicious_links'], 'only the threat lists are moved');

  let steps = 0;
  while (await moveStep()) steps += 1;
  assert.ok(steps >= 1, 'it moves a piece');
  assert.equal(await seeAll('public', 'malicious_links', mineLinks), 0, 'nothing of this test is left in the main database');
  assert.equal(await dataMove.pending().then(async (any) => (any ? await seeAll('public', 'malicious_links', mineLinks) : 0)), 0);
  assert.equal(await seeAll('data2', 'malicious_links', mineLinks), 3);

  // The threat lists: written and read in the second database.
  await links.upsertMaliciousLinks([{ normalizedUrl: 'data2-check.example/new', hostname: 'data2-check.example', threatTypes: ['MALWARE'], source: 'openphish' }]);
  assert.equal(await seeAll('data2', 'malicious_links', mineLinks), 4);
  assert.equal(await seeAll('public', 'malicious_links', mineLinks), 0, 'nothing goes to the main database');
  assert.equal((await links.getKnownMalicious('data2-check.example/new', { force: true }))?.source, 'openphish');
  assert.equal(await links.pruneStaleFeedLinks('openphish', 14), 0, 'a fresh entry is kept');

  config.data2DatabaseUrl = null;
  assert.equal(secondary.isSeparate(), false, 'without it everything is in the main database again');
  await clean();
  await secondary.closeSecondary();
  await main.query('drop schema data2 cascade');
  await closePools();
  console.log('check-secondary-db: ok');
})().catch((error) => { console.error(error); process.exit(1); });
