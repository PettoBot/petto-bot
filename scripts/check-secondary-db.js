// Checks the second database (PETTO_DATA2_DATABASE_URL) for the heavy data: the tables are made there, what the main database already has is moved over
// without losing anything, new copies and threat links go to the second one, and the copies whose avatar left the history are deleted. The second database is
// a schema of the test database here (search_path), which is the same thing for the code. Runs when PETTO_TEST_DATABASE_URL is set.
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
const images = require('../src/db/profileHistoryImages');
const links = require('../src/db/maliciousLinks');
const { moveStep, reconcileAll } = require('../src/jobs/dataMoveJob');
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const U = (n) => `93000000000000${String(n).padStart(2, '0')}`;
const H = (n) => n.toString(16).padStart(32, '0');
const bytes = Buffer.from('RIFF0000WEBPVP8 test');

(async () => {
  const main = getPrimaryPool();
  await main.query('drop schema if exists data2 cascade');
  await main.query('create schema data2');
  const clean = async () => {
    await main.query("delete from public.profile_history_images where user_id like '93000000000000%'");
    await main.query("delete from identity_history where user_id like '93000000000000%'");
    await main.query("delete from identity_history_optout where user_id like '93000000000000%'");
    await main.query("delete from public.malicious_links where normalized_url like 'data2-check.example/%'");
  };
  await clean();
  const seeAll = async (schema, table, where) => Number((await main.query(`select count(*) from ${schema}.${table} where ${where}`)).rows[0].count);
  const mine = "user_id like '93000000000000%'";
  const mineLinks = "normalized_url like 'data2-check.example/%'";

  // History: person 1 has avatars 1 and 2, person 2 has avatar 1; person 3 has turned the history off.
  for (const [u, h] of [[1, 1], [1, 2], [2, 1], [3, 1]]) await main.query("insert into identity_history (user_id, kind, value) values ($1, 'avatar', $2)", [U(u), H(h)]);
  // The main database already has the copies and the links (as it did before the second database).
  for (const [u, h] of [[1, 1], [1, 2], [2, 1]]) await main.query('insert into public.profile_history_images (user_id, hash, size, bytes) values ($1, $2, $3, $4)', [U(u), H(h), bytes.length, bytes]);
  for (const name of ['a', 'b', 'c']) await main.query("insert into public.malicious_links (normalized_url, hostname, source, reported_by) values ($1, 'data2-check.example', 'user_report', 'x')", [`data2-check.example/${name}`]);

  // With a second database the tables are made there, and nothing is lost while the rest is moved: a copy not moved yet is still found in the main one.
  config.data2DatabaseUrl = `${url}${url.includes('?') ? '&' : '?'}options=-csearch_path%3Ddata2`;
  assert.equal(secondary.isSeparate(), true);
  images.setMovePending(true);
  assert.equal((await images.get(U(1), H(1))).size, bytes.length, 'a copy not moved yet is read from the main database');
  assert.equal((await images.getMany(U(1), [H(1), H(2)])).size, 2);
  assert.deepEqual((await images.status(U(2), H(1))).size, bytes.length);
  assert.equal(await seeAll('data2', 'profile_history_images', mine), 0, 'the second database starts empty');

  let steps = 0;
  while (await moveStep()) steps += 1;
  assert.ok(steps >= 2, 'it moves a piece of each table');
  assert.equal(await dataMove.pending().then(async (any) => (any ? (await seeAll('public', 'profile_history_images', mine)) + (await seeAll('public', 'malicious_links', mineLinks)) : 0)), 0, 'nothing of this test is left in the main database');
  assert.equal(await seeAll('data2', 'profile_history_images', mine), 3);
  assert.equal(await seeAll('data2', 'malicious_links', mineLinks), 3);
  images.setMovePending(false);
  assert.equal((await images.get(U(1), H(2))).size, bytes.length, 'and it is read from the second database');

  // New copies are written in the second database, only for what the history has, and the person keeps their newest ones.
  assert.equal(await images.store(U(2), H(2), { contentType: 'image/webp', bytes }), false, 'an avatar that is not in the history is not copied');
  assert.equal(await images.store(U(3), H(1), { contentType: 'image/webp', bytes }), true, 'person 3 has the avatar in the history (their opt-out comes next)');
  await main.query("insert into identity_history_optout (user_id) values ($1)", [U(3)]);
  assert.equal(await images.store(U(3), H(1), { contentType: 'image/webp', bytes }), false, 'with the history turned off nothing is copied');
  assert.equal(await seeAll('public', 'profile_history_images', mine), 0, 'the main database gets nothing');
  const candidates = await images.backfillCandidates(null, 500);
  assert.ok(!candidates.rows.some((row) => row.user_id === U(1)), 'an avatar that has its copy (in the second database) is not tried again');

  // What the triggers did in the main database is done by the hourly pass: a copy whose avatar left the history, or whose person turned it off, goes.
  await main.query("delete from identity_history where user_id = $1 and value = $2", [U(1), H(2)]);
  const removed = await reconcileAll(async () => {});
  assert.equal(removed, 2, 'the copy of the deleted entry and the one of the person who turned it off');
  assert.equal(await seeAll('data2', 'profile_history_images', mine), 2, 'what is still in a history stays');
  await images.clearUser(U(1));
  assert.equal(await seeAll('data2', 'profile_history_images', `${mine} and user_id = '${U(1)}'`), 0, 'clearing the history deletes the copies there');

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
