// Checks the table of members whose join messages wait (src/db/joinWaiting.js) against a real PostgreSQL database: a member is added once,
// taken once (the single DELETE that makes each message go out once), the rows past 7 days are removed, and the numbers by server.
// Runs when PETTO_TEST_DATABASE_URL points to a test database that has the schema, and is skipped otherwise.
const assert = require('node:assert/strict');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the join waiting database check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
delete process.env.PETTO_CODE_DATABASE_URL;
const waiting = require('../src/db/joinWaiting');
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const G1 = '910000000000000001';
const G2 = '910000000000000002';

(async () => {
  const pool = getPrimaryPool();
  const clean = async () => {
    await pool.query("delete from guilds where guild_id like '9100000000000000%'"); // the waiting rows go with them (foreign key)
  };
  await clean();
  try {
    await pool.query('insert into guilds (guild_id) values ($1), ($2)', [G1, G2]);

    assert.equal(await waiting.add(G1, 'u1'), true, 'a member is added');
    assert.equal(await waiting.add(G1, 'u1'), false, 'adding them again changes nothing');
    assert.equal(await waiting.add(G1, 'u2'), true);
    assert.equal(await waiting.add(G2, 'u1'), true, 'the same member in another server is another row');
    assert.deepEqual([...(await waiting.countsByGuild())].filter(([guild]) => guild.startsWith('91000000')).sort(), [[G1, 2], [G2, 1]]);

    // Two takes at the same moment: exactly one gets the row.
    const [a, b] = await Promise.all([waiting.take(G1, 'u1'), waiting.take(G1, 'u1')]);
    assert.equal([a, b].filter(Boolean).length, 1, 'only one of two simultaneous takes gets the member');
    assert.equal((a ?? b).expired, false, 'a recent wait is not expired');
    assert.equal(await waiting.take(G1, 'u1'), null, 'a member who is not waiting gives nothing');

    // The safety limit of the onboarding: a row with a limit is due when it passes; one with none never is until a limit starts.
    assert.equal(await waiting.add(G1, 'd1', 30), true);
    assert.equal(await waiting.add(G1, 'd2'), true);
    assert.equal(await waiting.startDue(G1, 'd1', 10), false, 'a limit that runs is not restarted');
    assert.equal(await waiting.startDue(G1, 'd2', 10), true, 'a member with no limit gets one');
    assert.equal(await waiting.startDue(G1, 'nobody', 10), false);
    assert.deepEqual((await waiting.takeDue()).filter((row) => row.guild_id === G1), [], 'nothing is due yet');
    await pool.query("update join_waiting set due_at = now() - interval '1 minute' where guild_id = $1 and user_id = 'd2'", [G1]);
    const due = (await waiting.takeDue()).filter((row) => row.guild_id === G1);
    assert.deepEqual(due, [{ guild_id: G1, user_id: 'd2' }], 'only the member whose limit passed is taken');
    assert.deepEqual((await waiting.takeDue()).filter((row) => row.guild_id === G1), [], 'and only once');
    assert.equal((await waiting.take(G1, 'd1')).expired, false);
    await waiting.add(G1, 'd3', 5);
    await pool.query("update join_waiting set due_at = now() - interval '1 minute', joined_at = now() - interval '8 days' where guild_id = $1 and user_id = 'd3'", [G1]);
    assert.deepEqual((await waiting.takeDue()).filter((row) => row.guild_id === G1), [], 'a wait past 7 days is not sent, only cleaned');
    await waiting.removeExpired();

    // 7 days.
    await pool.query("update join_waiting set joined_at = now() - interval '8 days' where guild_id = $1 and user_id = 'u2'", [G1]);
    assert.equal((await waiting.take(G1, 'u2')).expired, true, 'a wait past 7 days says so');
    await waiting.add(G1, 'u3');
    await pool.query("update join_waiting set joined_at = now() - interval '7 days 1 hour' where guild_id = $1 and user_id = 'u3'", [G1]);
    await waiting.add(G1, 'u4');
    await pool.query("update join_waiting set joined_at = now() - interval '6 days' where guild_id = $1 and user_id = 'u4'", [G1]);
    const removed = (await waiting.removeExpired()).filter((guild) => guild.startsWith('91000000'));
    assert.deepEqual(removed, [G1], 'the cleanup removes only what is past 7 days');
    assert.equal((await waiting.take(G1, 'u4')).expired, false, 'and keeps the rest');
    await waiting.add(G2, 'u9');

    // A server that is deleted takes its waiting members with it.
    await pool.query('delete from guilds where guild_id = $1', [G2]);
    assert.equal(await waiting.take(G2, 'u1'), null);
    console.log('join waiting database check ok');
  } finally {
    await clean().catch(() => {});
    await closePools();
  }
})().catch((error) => { console.error(error); process.exit(1); });
