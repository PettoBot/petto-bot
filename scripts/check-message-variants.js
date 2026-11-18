// Checks the several messages of the welcome, the goodbye and the boost against a real PostgreSQL database (PETTO_TEST_DATABASE_URL; skipped without it): the pick is
// random and never the same twice in a row, every message gets used, the first one counts, 25 is the most, a number removes the right one, and they go with the server.
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL ||= process.env.PETTO_TEST_DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x'; // not connected for the choice itself
const { chooseIndex } = require('../src/utils/messageVariants');
// The choice itself needs no database.
{
  assert.equal(chooseIndex(1, null), 0, 'one message is that message');
  assert.equal(chooseIndex(0, null), 0);
  for (let count = 2; count <= 6; count += 1) {
    for (let last = 0; last < count; last += 1) {
      const seen = new Set();
      for (let step = 0; step < 400; step += 1) {
        const pick = chooseIndex(count, last);
        assert.ok(pick >= 0 && pick < count && pick !== last, `never the last (${count} messages, last ${last}, got ${pick})`);
        seen.add(pick);
      }
      assert.equal(seen.size, count - 1, 'every other message can come');
    }
  }
  assert.equal(chooseIndex(3, null, () => 0.999), 2, 'the first pick can be any message');
  assert.equal(chooseIndex(3, 0, () => 0), 1);
  assert.equal(chooseIndex(3, 2, () => 0.999), 1);
}

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Checked the choice of a message (skipped the database part: set PETTO_TEST_DATABASE_URL).');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
delete process.env.PETTO_CODE_DATABASE_URL;
const { getPrimaryPool, closePools } = require('../src/db/postgres');
const variants = require('../src/utils/messageVariants');

const G = '9300000000000000001';
const MAIN = { message: 'main', template: null };

(async () => {
  const pool = getPrimaryPool();
  await pool.query('delete from guilds where guild_id = $1', [G]);
  await pool.query('insert into guilds (guild_id) values ($1)', [G]);

  // With nothing else saved, the first message is sent as it is (a server that never used this costs one read).
  assert.deepEqual(await variants.pickMessage(G, 'welcome', MAIN), MAIN);

  for (const text of ['two', 'three']) assert.equal((await variants.addVariant(G, 'welcome', { message: text, template: null })).ok, true);
  assert.deepEqual((await variants.addVariant(G, 'welcome', { message: '  ', template: null })), { ok: false, reason: 'empty' }, 'an empty message is not added');
  assert.equal((await variants.addVariant(G, 'leave', { message: null, template: 'bye-design' })).ok, true, 'a saved embed counts as a message');
  assert.equal((await variants.variantsOf(G, 'welcome')).length, 2, 'each kind has its own list');
  assert.equal((await variants.variantsOf(G, 'boost')).length, 0);

  // Many welcomes: all three messages are used and the same one never comes twice in a row.
  let previous = null;
  const used = new Set();
  for (let step = 0; step < 300; step += 1) {
    const picked = (await variants.pickMessage(G, 'welcome', MAIN)).message;
    assert.notEqual(picked, previous, 'never the same message twice in a row');
    used.add(picked); previous = picked;
  }
  assert.deepEqual([...used].sort(), ['main', 'three', 'two'], 'the first message and the others are all used');

  // Without a first message, the others are the pool.
  const noMain = new Set();
  for (let step = 0; step < 60; step += 1) noMain.add((await variants.pickMessage(G, 'welcome', { message: null, template: null })).message);
  assert.deepEqual([...noMain].sort(), ['three', 'two']);

  // The list is numbered with the first message as 1: 2 is the first of the others.
  assert.equal(await variants.removeVariant(G, 'welcome', 1), false, 'number 1 is the main message and is not removed here');
  assert.equal(await variants.removeVariant(G, 'welcome', 9), false, 'a number that is not there');
  assert.equal(await variants.removeVariant(G, 'welcome', 2), true);
  assert.deepEqual((await variants.variantsOf(G, 'welcome')).map((v) => v.message), ['three'], 'the right one was removed');

  // 25 in all: the first and 24 more.
  for (let i = 0; i < variants.MAX_EXTRA - 1; i += 1) assert.equal((await variants.addVariant(G, 'boost', { message: `m${i}`, template: null })).ok, true);
  assert.equal((await variants.addVariant(G, 'boost', { message: 'last', template: null })).ok, true);
  assert.deepEqual(await variants.addVariant(G, 'boost', { message: 'too many', template: null }), { ok: false, reason: 'full' }, '25 messages in all is the most');
  assert.equal((await variants.variantsOf(G, 'boost')).length, 24);

  // The database refuses what the code never writes.
  await assert.rejects(pool.query("insert into member_event_variants (guild_id, kind, message) values ($1, 'other', 'x')", [G]), /check/);
  await assert.rejects(pool.query("insert into member_event_variants (guild_id, kind) values ($1, 'welcome')", [G]), /check/);

  // They go with the server.
  await pool.query('delete from guilds where guild_id = $1', [G]);
  assert.equal(Number((await pool.query('select count(*)::int as n from member_event_variants where guild_id = $1', [G])).rows[0].n), 0);
  await closePools();
  console.log('Checked the several messages: the choice, the order, the limit of 25, the numbers, and that they go with the server.');
})().catch((err) => { console.error(err); process.exit(1); });
