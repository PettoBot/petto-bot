// Checks that the AFK mentions older than three days are deleted (and the ones inside the three days are not), against a real PostgreSQL
// when PETTO_TEST_DATABASE_URL points to a test database. Without one, only the shape of the job is checked.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL = process.env.PETTO_TEST_DATABASE_URL || 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const afk = require('../src/db/afk');
  assert.equal(afk.THREE_DAYS_MS, 3 * 86_400_000);
  const jobSource = fs.readFileSync(path.join(__dirname, '../src/jobs/afkMentionsJob.js'), 'utf8');
  assert.ok(jobSource.includes('deleteExpiredMentions'), 'the job deletes the expired mentions');
  assert.ok(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8').includes('startAfkMentionsJob();'), 'the job is started with the bot');

  if (!process.env.PETTO_TEST_DATABASE_URL) {
    console.log('check-afk-mentions-expire: ok (the database part was skipped: set PETTO_TEST_DATABASE_URL to a test database to run it)');
    process.exit(0);
  }
  const { getPrimaryPool, closePools } = require('../src/db/postgres');
  const pool = getPrimaryPool();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(schema); // the bot applies it on every start
  const G = '930000000000000001';
  const U = '940000000000000001';
  const clean = () => pool.query('delete from guilds where guild_id = $1', [G]);
  await clean();
  await pool.query('insert into guilds (guild_id) values ($1)', [G]);
  const day = 86_400_000;
  const at = (ago) => new Date(Date.now() - ago).toISOString();
  const add = (name, ago) => pool.query('insert into afk_mentions (guild_id, afk_user_id, mentioned_by, channel_id, content, created_at) values ($1, $2, $3, $4, $5, $6)', [G, U, 'm', 'c', name, at(ago)]);
  await add('old-4d', 4 * day);
  await add('old-30d', 30 * day);
  await add('just-over-3d', 3 * day + 60_000);
  await add('just-under-3d', 3 * day - 60_000);
  await add('new', 1000);
  assert.equal((await afk.listRecentMentions(G, U)).length, 2, 'the list shows the two inside the three days');

  await afk.deleteExpiredMentions();
  const left = (await pool.query('select content from afk_mentions where guild_id = $1 order by created_at', [G])).rows.map((row) => row.content);
  assert.deepEqual(left, ['just-under-3d', 'new'], 'only what the list shows is left');
  assert.equal(await afk.countRecentMentions(G, U), 2);
  await afk.deleteExpiredMentions(); // nothing left to delete is not an error
  assert.equal(Number((await pool.query('select count(*) from afk_mentions where guild_id = $1', [G])).rows[0].count), 2);

  await clean();
  await closePools();
  console.log('check-afk-mentions-expire: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
