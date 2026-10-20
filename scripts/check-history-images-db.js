// Checks the avatar copies of the profile history against a real PostgreSQL database: schema.sql applies twice, a copy is only stored
// for an avatar of the history of someone who did not turn it off, 100 per person, the 404 marks, the backfill list, and the triggers that
// delete the copies when an entry is deleted or the history is turned off (also when the dashboard does it, straight in the tables).
// It runs when PETTO_TEST_DATABASE_URL points to an empty test database, and is skipped otherwise.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the history copies database check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
const images = require('../src/db/profileHistoryImages');
const history = require('../src/db/identityHistory');
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const A = '900000000000000001';
const B = '900000000000000002';
const hash = (n) => n.toString(16).padStart(32, '0');
const bytes = Buffer.from('RIFF0000WEBPVP8 test');

(async () => {
  const pool = getPrimaryPool();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(schema); // the bot applies it on every start
  for (const table of ['profile_history_images', 'identity_history', 'identity_history_optout']) await pool.query(`delete from ${table} where user_id in ($1, $2)`, [A, B]);
  const addAvatar = (user, n, minutesAgo = 0) => pool.query(`insert into identity_history (user_id, kind, value, seen_at) values ($1, 'avatar', $2, now() - make_interval(mins => $3))`, [user, hash(n), minutesAgo]);
  const count = async (user) => Number((await pool.query('select count(*) from profile_history_images where user_id = $1', [user])).rows[0].count);

  assert.equal(await images.store(A, hash(1), { contentType: 'image/webp', bytes }), false, 'no copy of an avatar that is not in the history');
  await addAvatar(A, 1, 10);
  assert.equal(await images.store(A, hash(1), { contentType: 'image/webp', bytes }), true);
  const got = await images.get(A, hash(1));
  assert.ok(Buffer.compare(got.bytes, bytes) === 0, 'the bytes come back');
  assert.equal(got.content_type, 'image/webp');
  assert.equal(await images.store(A, hash(1), { contentType: 'image/webp', bytes: Buffer.alloc(images.MAX_BYTES + 1) }), false, 'too big');
  assert.equal(await images.recorded(A, hash(1)), true);
  assert.equal(await images.recorded(A, hash(2)), false);

  // Marks: a 404 is remembered; a failed try is counted; a stored copy is not touched by a mark.
  await addAvatar(A, 2, 9);
  await addAvatar(A, 3, 8);
  await images.markFailed(A, hash(2), { missing: true });
  await images.markFailed(A, hash(3));
  await images.markFailed(A, hash(1), { missing: true });
  assert.deepEqual(await images.status(A, hash(2)), { size: 0, missing: true, attempts: 1 });
  assert.deepEqual(await images.status(A, hash(3)), { size: 0, missing: false, attempts: 1 });
  assert.equal((await images.status(A, hash(1))).missing, false, 'a kept copy stays');
  assert.equal(await images.get(A, hash(2)), null);
  // The backfill reads the whole history in pieces, newest first, and returns what is worth a try.
  const everything = async () => {
    const found = [];
    let cursor = null;
    let pieces = 0;
    do {
      const piece = await images.backfillCandidates(cursor, 2);
      found.push(...piece.rows.filter((row) => row.user_id === A).map((row) => row.hash));
      cursor = piece.cursor;
      pieces += 1;
    } while (cursor !== null && pieces < 10_000);
    return found;
  };
  assert.deepEqual(await everything(), [hash(3)], 'the backfill skips the kept and the missing ones');
  await images.markFailed(A, hash(3));
  await images.markFailed(A, hash(3));
  assert.deepEqual(await everything(), [], 'and gives up after 3 failed tries');
  assert.deepEqual(await images.backfillCandidates('1', 5), { rows: [], cursor: null }, 'nothing before the first entry');
  assert.equal((await images.getMany(A, [hash(1), hash(2), hash(3)])).size, 1);

  // At most 100 per person: the newest avatars of the history.
  for (let n = 10; n < 112; n += 1) {
    await addAvatar(A, n, -n); // newer than the first ones
    await images.store(A, hash(n), { contentType: 'image/webp', bytes });
  }
  assert.equal(await count(A), images.KEEP_PER_USER, 'the copies of the oldest go');
  assert.equal(await images.get(A, hash(1)), null);
  assert.ok(await images.get(A, hash(111)));
  await addAvatar(A, 500, 7); // older than the newest 100: not tried, its copy would not be kept
  assert.ok(!(await images.backfillCandidates(null, 500)).rows.some((row) => row.user_id === A && row.hash === hash(500)), 'beyond the newest 100 nothing is tried');
  await addAvatar(A, 501, -1000); // the newest: tried
  assert.ok((await images.backfillCandidates(null, 500)).rows.some((row) => row.user_id === A && row.hash === hash(501)));

  // The triggers: deleting an entry (the dashboard deletes rows straight in the table) deletes its copy, unless the hash is saved twice.
  await pool.query(`delete from identity_history where user_id = $1 and value = $2`, [A, hash(111)]);
  assert.equal(await images.get(A, hash(111)), null, 'the copy goes with its entry');
  await addAvatar(A, 110, -500);
  await pool.query(`delete from identity_history where id = (select min(id) from identity_history where user_id = $1 and value = $2)`, [A, hash(110)]);
  assert.ok(await images.get(A, hash(110)), 'kept while the same avatar is still in the history');

  // Turning the history off deletes every copy, from the bot or straight in the table, and stops new ones.
  await addAvatar(B, 1);
  await images.store(B, hash(1), { contentType: 'image/webp', bytes });
  await pool.query('insert into identity_history_optout (user_id) values ($1)', [B]);
  assert.equal(await count(B), 0, 'the dashboard\'s opt-out deletes the copies');
  assert.equal(await images.store(B, hash(1), { contentType: 'image/webp', bytes }), false, 'and none is stored while it is off');
  assert.deepEqual((await images.backfillCandidates(null, 500)).rows.filter((row) => row.user_id === B), [], 'nor tried by the backfill');
  await history.setOptOut(B, false);
  assert.equal(await images.store(B, hash(1), { contentType: 'image/webp', bytes }), true);
  await history.setOptOut(B, true);
  assert.equal(await count(B), 0, 'the bot\'s opt-out too');
  // The bot's clear of the avatars.
  assert.ok(await count(A) > 0);
  await history.clear(A, 'avatar');
  assert.equal(await count(A), 0, 'deleting the avatars deletes the copies');
  assert.ok(await images.totalSize() >= 0);

  for (const table of ['profile_history_images', 'identity_history', 'identity_history_optout']) await pool.query(`delete from ${table} where user_id in ($1, $2)`, [A, B]);
  await closePools();
  console.log('Checked the avatar copies of the history in PostgreSQL: storing, the limits, the marks, the backfill list and the triggers.');
})().catch(async (err) => { console.error(err); process.exit(1); });
