// Checks the stored data of custom commands against a real PostgreSQL database. It runs when PETTO_TEST_DATABASE_URL points
// to an empty test database, and is skipped otherwise.
const assert = require('node:assert/strict');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the stored data check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
delete process.env.PETTO_CODE_DATABASE_URL;
const commandData = require('../src/db/commandData');
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const pool = getPrimaryPool();
  await pool.query('drop table if exists custom_command_data');
  const a = commandData.forGuild('100000000000000001');
  const b = commandData.forGuild('100000000000000002');

  // Values of every shape, per server and per member.
  assert.equal(await a.get('x', ''), null);
  await a.set('x', { list: [1, 'two', true, null], n: 1.5 }, '', null);
  assert.deepEqual(await a.get('x', ''), { list: [1, 'two', true, null], n: 1.5 });
  assert.equal(await b.get('x', ''), null, 'one server does not see the data of another');
  await a.set('x', 'again', '', null);
  assert.equal(await a.get('x', ''), 'again', 'setting a key again replaces it');
  await a.set('x', 'mine', '200000000000000001', null);
  assert.equal(await a.get('x', '200000000000000001'), 'mine');
  assert.equal(await a.get('x', ''), 'again', 'a member has their own value for the same key');
  await a.del('x', ''); assert.equal(await a.get('x', ''), null);

  // Expiry.
  await a.set('temp', 'soon gone', '', 1);
  assert.equal(await a.get('temp', ''), 'soon gone');
  await sleep(1200);
  assert.equal(await a.get('temp', ''), null, 'an expired value is not read');
  assert.ok((await commandData.purgeExpired()) >= 1, 'and it is removed');
  await a.set('temp', 'back', '', null);
  assert.equal(await a.get('temp', ''), 'back', 'a key can be used again after it expired');

  // Counting: atomic, and only on numbers.
  assert.equal(await a.incr('count', 5, ''), 5);
  assert.equal(await a.incr('count', -2, ''), 3);
  assert.equal(await a.incr('count', 0.5, ''), 3.5);
  const results = await Promise.all(Array.from({ length: 20 }, () => a.incr('race', 1, '')));
  assert.equal(await a.get('race', ''), 20, 'twenty uses at the same time count twenty');
  assert.equal(new Set(results).size, 20, 'and each one saw its own number');
  await a.set('text', 'hello', '', null);
  await assert.rejects(a.incr('text', 1, ''), /does not hold a number/);
  await a.set('short', 1, '', 1); await sleep(1200);
  assert.equal(await a.incr('short', 1, ''), 1, 'counting over an expired key starts again');

  // Rankings and keys.
  for (const [user, points] of [['300000000000000001', 10], ['300000000000000002', 30], ['300000000000000003', 20]]) await a.incr('points', points, user);
  await a.set('points', 'not a number', '300000000000000004', null);
  await a.incr('points', 99, '');
  assert.deepEqual(await a.top('points', 2), [{ UserID: '300000000000000002', Value: 30 }, { UserID: '300000000000000003', Value: 20 }], 'the top is of members with numbers, highest first');
  await a.set('a_b', 1, '', null); await a.set('axb', 1, '', null); await a.set('50%', 1, '', null); await a.set('500', 1, '', null);
  assert.deepEqual(await a.keys('a_', ''), ['a_b'], 'a _ in a prefix is a _, not any character');
  assert.deepEqual(await a.keys('50%', ''), ['50%'], 'a % in a prefix is a %');
  assert.ok((await a.keys('', '')).length >= 6);

  // The most a server can store.
  await pool.query('delete from custom_command_data where guild_id = $1', ['100000000000000002']);
  await pool.query(`insert into custom_command_data (guild_id, key, value) select '100000000000000002', 'k' || g, '1'::jsonb from generate_series(1, ${commandData.MAX_ENTRIES_PER_GUILD}) g`);
  await assert.rejects(b.set('one-more', 1, '', null), /already stores/);
  await assert.rejects(b.incr('one-more', 1, ''), /already stores/);
  await b.set('k1', 2, '', null);
  assert.equal(await b.get('k1', ''), 2, 'a key that exists can still change when the server is full');
  assert.equal(await commandData.deleteGuildData('100000000000000002'), commandData.MAX_ENTRIES_PER_GUILD);

  await pool.query('drop table custom_command_data');
  await closePools();
  console.log('Checked the stored data of custom commands against a real database.');
})().catch((error) => { console.error(error); process.exit(1); });
