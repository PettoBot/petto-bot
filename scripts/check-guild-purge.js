// Checks the cleanup of the servers Petto left against a real PostgreSQL database: what is deleted after the days, what is kept, and the guards.
// It runs when PETTO_TEST_DATABASE_URL points to a test database, and is skipped otherwise.
const assert = require('node:assert/strict');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the servers cleanup check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
delete process.env.PETTO_CODE_DATABASE_URL;
const config = require('../src/config');
const departures = require('../src/db/guildDepartures');
const commandData = require('../src/db/commandData');
const { purgeLeftGuilds } = require('../src/jobs/guildPurgeJob');
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const G = (n) => `9100000000000000${String(n).padStart(2, '0')}`;
const clientWith = (ids, expected = 0) => ({ isReady: () => true, guilds: { cache: new Map(ids.map((id) => [id, {}])) }, application: { fetch: async () => ({ approximateGuildCount: expected || ids.length }) } });

(async () => {
  const pool = getPrimaryPool();
  await pool.query(commandData.SCHEMA); // another check drops this table when it ends
  const clean = async () => {
    for (const table of ['guild_member_days', 'guild_backups', 'disabled_commands', 'custom_command_data']) await pool.query(`delete from ${table} where guild_id like '91000000000000%'`);
    await pool.query("delete from guild_departures where guild_id like '91000000000000%'");
    await pool.query("delete from guilds where guild_id like '91000000000000%'");
  };
  await clean();
  const count = async (table, id) => Number((await pool.query(`select count(*) from ${table} where guild_id = $1`, [id])).rows[0].count);
  const makeGuild = async (id) => {
    await pool.query('insert into guilds (guild_id) values ($1)', [id]);
    await pool.query("insert into disabled_commands (guild_id, command) values ($1, 'ping')", [id]); // goes with the server by its foreign key
    await pool.query("insert into guild_member_days (guild_id, day, members) values ($1, now()::date, 5)", [id]); // has no foreign key: deleted by name
  };

  // The tables with a guild_id that have to be deleted by name are found by themselves; what a person paid for is never among them.
  const loose = await departures.looseTables();
  assert.ok(loose.includes('guild_member_days') && loose.includes('dash_access'), 'the tables without a foreign key are found');
  assert.ok(!loose.some((name) => ['premium_slot_assignments', 'premium_slot_requests', 'guilds', 'guild_departures'].includes(name)), 'Premium is left alone');

  // Servers: 1 is still there; 2 left 5 days ago; 3 has just been noticed as missing; 4 left long ago but has a backup; 5 left 5 days ago but came back.
  for (const n of [1, 2, 3, 4, 5]) await makeGuild(G(n));
  await pool.query("insert into guild_backups (guild_id, backup_number, created_by, snapshot) values ($1, 1, 'x', '{}')", [G(4)]);
  await pool.query("insert into guild_departures (guild_id, left_at) values ($1, now() - interval '5 days'), ($2, now() - interval '9 days'), ($3, now() - interval '5 days')", [G(2), G(4), G(5)]);

  config.guildPurge = true; config.guildPurgeDays = 3; config.guildPurgeDryRun = false;
  // Only the servers of this check are looked at: the others of the test database are "present" too.
  const others = (await pool.query("select guild_id from guilds where guild_id not like '91000000000000%'")).rows.map((row) => row.guild_id);
  const client = clientWith([...others, G(1), G(5)]);

  config.guildPurgeDryRun = true;
  const dry = await purgeLeftGuilds(client);
  assert.equal(await count('guilds', G(2)), 1, 'a dry run deletes nothing');
  assert.deepEqual([dry.erased, dry.would], [0, 1], 'and it says how many it would delete');
  config.guildPurgeDryRun = false;

  const result = await purgeLeftGuilds(client);
  assert.deepEqual([result.erased, result.held], [1, 1]);
  assert.equal(await count('guilds', G(2)), 0, 'the server that left 5 days ago is gone');
  assert.equal(await count('disabled_commands', G(2)), 0, 'with what hangs from it by a foreign key');
  assert.equal(await count('guild_member_days', G(2)), 0, 'and what has none');
  assert.equal(await count('guilds', G(1)), 1, 'a server Petto is in is not touched');
  assert.equal(await count('guilds', G(5)), 1, 'one that came back keeps everything');
  assert.equal(await count('guilds', G(4)), 1, 'a server with backups kept in this database waits');
  assert.equal(await count('guilds', G(3)), 1, 'a server just noticed as missing is not deleted yet');
  const dates = (await pool.query('select guild_id from guild_departures where guild_id like $1 order by 1', ['91000000000000%'])).rows.map((row) => row.guild_id);
  assert.deepEqual(dates, [G(3), G(4)], 'the one that is missing gets its date, the one that came back loses it, the deleted one is forgotten');

  // Discord says the bot is in more servers than the bot has loaded: nothing is decided.
  await clean();
  for (let n = 1; n <= 20; n += 1) await makeGuild(G(n));
  await pool.query("insert into guild_departures (guild_id, left_at) values ($1, now() - interval '9 days')", [G(20)]);
  const few = await purgeLeftGuilds(clientWith([...others, G(1), G(2), G(3)], others.length + 100));
  assert.deepEqual([few.noted, few.erased], [0, 0], 'an outage is not people leaving');
  assert.equal(await count('guilds', G(20)), 1);
  assert.equal((await purgeLeftGuilds({ isReady: () => false, guilds: { cache: new Map() } })).erased, 0, 'nothing while the bot is not ready');
  config.guildPurge = false;
  assert.equal((await purgeLeftGuilds(clientWith([...others, G(1)]))).erased, 0, 'GUILD_PURGE=false turns it off');

  await clean();
  await closePools();
  console.log('check-guild-purge: ok');
})().catch((error) => { console.error(error); process.exit(1); });
