// Checks scripts/purge-avatar-history.js, the tool the owner runs by hand to delete what the avatar history left: a dry run counts and deletes nothing,
// `--yes` deletes the avatar entries and the avatar copies (also in a second database) and leaves the names, nicknames and opt-outs alone, and nothing deletes
// by itself (schema.sql has no drop or delete of it). Runs when PETTO_TEST_DATABASE_URL points to a test database, and is skipped otherwise.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
assert.ok(!/profile_history_images/.test(schema.replace(/--.*$/gm, '')), 'schema.sql no longer makes, drops or deletes from the avatar copies');
assert.ok(!/delete\s+from\s+identity_history|drop\s+table[^;]*identity_history/i.test(schema), 'schema.sql does not delete the history');
const index = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
assert.ok(!/purge-avatar-history/.test(index), 'the boot does not run the purge');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Checked that nothing deletes the avatar history by itself (set PETTO_TEST_DATABASE_URL to a test database to run the purge script too).');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
delete process.env.PETTO_DATA2_DATABASE_URL;
const config = require('../src/config');
const secondary = require('../src/db/secondary');
const { getPrimaryPool, closePools } = require('../src/db/postgres');
const purge = require('./purge-avatar-history');

const U = (n) => `94000000000000${String(n).padStart(2, '0')}`;
const H = (n) => n.toString(16).padStart(32, '0');
const bytes = Buffer.from('RIFF0000WEBPVP8 test');
const places = (main, second = null) => [{ label: 'main database', pool: main, history: true }, ...(second ? [{ label: 'second database', pool: second, history: false }] : [])];

(async () => {
  const main = getPrimaryPool();
  const count = async (sql) => Number((await main.query(sql)).rows[0].count);
  const mine = "user_id like '94000000000000%'";
  const clean = async () => {
    await main.query(`delete from identity_history where ${mine}`);
    await main.query(`delete from identity_history_optout where ${mine}`);
    await main.query(`delete from identity_audit_events where user_id like '94000000000000%'`);
    await main.query('drop schema if exists data2 cascade');
  };
  await clean();
  // An install from before the avatar history was removed has the table of copies (a new one does not).
  await main.query(`create table if not exists profile_history_images (user_id text not null, hash text not null, content_type text not null default 'image/webp', size integer not null default 0, bytes bytea, missing boolean not null default false, attempts integer not null default 0, packed boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id, hash))`);
  await main.query(`delete from profile_history_images where ${mine}`);
  for (const [user, kind, value] of [[1, 'avatar', H(1)], [1, 'avatar', H(2)], [1, 'name', 'Liam'], [1, 'nickname', 'li'], [2, 'avatar', H(1)], [2, 'name', 'Ana']]) {
    await main.query('insert into identity_history (user_id, kind, value) values ($1, $2, $3)', [U(user), kind, value]);
  }
  await main.query('insert into identity_history_optout (user_id) values ($1)', [U(3)]);
  await main.query("insert into identity_audit_events (event_type, dedupe_key, user_id) values ('check', $1, $2)", ['purge-check', U(1)]);
  for (const [user, hash] of [[1, 1], [1, 2], [2, 1]]) await main.query('insert into profile_history_images (user_id, hash, size, bytes) values ($1, $2, $3, $4)', [U(user), H(hash), bytes.length, bytes]);
  const state = async () => ({
    avatars: await count(`select count(*) from identity_history where kind = 'avatar' and ${mine}`),
    names: await count(`select count(*) from identity_history where kind in ('name', 'nickname') and ${mine}`),
    copies: await count(`select count(*) from profile_history_images where ${mine}`),
    optouts: await count(`select count(*) from identity_history_optout where ${mine}`),
    audit: await count(`select count(*) from identity_audit_events where dedupe_key = 'purge-check'`),
  });

  // The dry run counts what is there and changes nothing.
  const surveyed = await purge.survey(places(main));
  assert.ok(surveyed[0].history.rows >= 3 && surveyed[0].copies.rows >= 3 && surveyed[0].copies.exists);
  assert.ok(purge.freed(surveyed) > 0, 'it says how much it would free');
  assert.ok(purge.describe(surveyed).some((line) => /avatar copies/.test(line)));
  const before = await state();
  assert.deepEqual(before, { avatars: 3, names: 3, copies: 3, optouts: 1, audit: 1 });
  const env = { ...process.env, DISCLOUD_DATABASE_URL: url };
  const dry = spawnSync(process.execPath, [path.join(__dirname, 'purge-avatar-history.js')], { env, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run: nothing was deleted/);
  assert.deepEqual(await state(), before, 'the script without --yes deletes nothing');
  const bad = spawnSync(process.execPath, [path.join(__dirname, 'purge-avatar-history.js'), '--delete'], { env, encoding: 'utf8' });
  assert.equal(bad.status, 1, 'a flag it does not know is refused');
  assert.deepEqual(await state(), before);

  // A second database (a schema of the test database) with copies of its own: both are cleaned.
  await main.query('create schema data2');
  await main.query('create table data2.profile_history_images (like public.profile_history_images including all)');
  await main.query('insert into data2.profile_history_images (user_id, hash, size, bytes) values ($1, $2, $3, $4)', [U(9), H(1), bytes.length, bytes]);
  config.data2DatabaseUrl = `${url}${url.includes('?') ? '&' : '?'}options=-csearch_path%3Ddata2`;
  assert.equal(secondary.isSeparate(), true);
  const both = await purge.survey(places(main, secondary.pool));
  assert.equal(both[1].copies.rows, 1, 'the second database is counted too');
  const done = await purge.purge(places(main, secondary.pool));
  assert.ok(done.history >= 3 && done.copies >= 4);
  assert.deepEqual(await state(), { avatars: 0, names: 3, copies: 0, optouts: 1, audit: 1 }, 'the avatars and copies are gone; names, nicknames, opt-outs and the audit events stay');
  assert.equal(Number((await main.query('select count(*) from data2.profile_history_images')).rows[0].count), 0);
  assert.equal(await main.query("select to_regclass('public.profile_history_images') as found").then((r) => r.rows[0].found !== null), true, 'the table itself is not dropped');

  // Running it again, with the copies table gone from a database that never had it, is fine.
  await main.query('drop table data2.profile_history_images');
  const none = await purge.survey(places(main, secondary.pool));
  assert.equal(none[1].copies.exists, false);
  assert.deepEqual(await purge.purge(places(main, secondary.pool)), { history: 0, copies: 0 });

  config.data2DatabaseUrl = null;
  await clean();
  await secondary.closeSecondary();
  await closePools();
  console.log('check-purge-avatar-history: ok');
})().catch((error) => { console.error(error); process.exit(1); });
