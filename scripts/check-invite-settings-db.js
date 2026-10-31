// Checks the invite settings against a real PostgreSQL database: the schema lines are safe to run twice, the defaults, a quick leave (inside and
// outside the window, a leave told twice, a fake join, a bot, a rejoin), and the leaderboards with and without the leaves taken off.
// Runs when PETTO_TEST_DATABASE_URL points to a test database that has the schema, and is skipped otherwise.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the invite settings database check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
delete process.env.PETTO_CODE_DATABASE_URL;
const tracking = require('../src/db/inviteTracking');
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const G = '920000000000000001';
const INVITER = '920000000000000100';

(async () => {
  const pool = getPrimaryPool();
  const clean = () => pool.query("delete from guilds where guild_id like '9200000000000000%'");
  await clean();
  try {
    // The schema lines of the settings can run again and again.
    const lines = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8').split('\n').filter((line) => /^alter table invite_config add column if not exists/.test(line));
    assert.equal(lines.length, 3);
    for (let i = 0; i < 2; i++) for (const line of lines) await pool.query(line);

    await pool.query('insert into guilds (guild_id) values ($1)', [G]);
    assert.deepEqual(await tracking.getSettings(G), { fakeDays: 3, quickLeaveMinutes: 0, ignoreBots: false, subtractLeaves: true }, 'a server with no row has the old behaviour');
    await tracking.setSettings(G, { quickLeaveMinutes: 10 });
    assert.deepEqual(await tracking.getSettings(G), { fakeDays: 3, quickLeaveMinutes: 10, ignoreBots: false, subtractLeaves: true }, 'only what is given changes');
    await tracking.setSettings(G, { fakeDays: 0, ignoreBots: true });
    assert.deepEqual(await tracking.getSettings(G), { fakeDays: 0, quickLeaveMinutes: 10, ignoreBots: true, subtractLeaves: true });
    await assert.rejects(tracking.setSettings(G, { quickLeaveMinutes: 5000 }), 'the database refuses minutes out of range');
    await tracking.setSettings(G, { ignoreBots: false });

    const stats = () => tracking.getStats(G, INVITER);
    const open = async (user, { ago = 0, minutes = 10 } = {}) => {
      await tracking.recordJoin(G, user, INVITER, 'code', { accountCreatedAt: Date.now() - 400 * 86_400_000 });
      if (ago) await pool.query("update member_invites set joined_at = now() - $3 * interval '1 minute' where guild_id = $1 and user_id = $2", [G, user, ago]);
    };

    // Inside the window: the join moves from joins to fake, nothing is left to count.
    await open('u1');
    assert.deepEqual([(await stats()).joins, (await stats()).fake], [1, 0]);
    let row = await tracking.recordLeave(G, 'u1');
    assert.equal(row.quick, true); assert.equal(row.fake, false, 'the row comes back as it was');
    let s = await stats();
    assert.deepEqual([s.joins, s.leaves, s.fake, s.total], [0, 0, 1, 0], 'a quick leave is a fake join, not a join and a leave');
    assert.equal((await pool.query("select fake, left_at is not null as left from member_invites where guild_id = $1 and user_id = 'u1'", [G])).rows[0].fake, true);
    assert.equal(await tracking.recordLeave(G, 'u1'), null, 'a leave told twice changes nothing');
    s = await stats();
    assert.deepEqual([s.joins, s.leaves, s.fake], [0, 0, 1], 'no double counting');

    // Outside the window: an ordinary leave.
    await open('u2', { ago: 11 });
    row = await tracking.recordLeave(G, 'u2');
    assert.equal(row.quick, false);
    s = await stats();
    assert.deepEqual([s.joins, s.leaves, s.fake, s.total], [1, 1, 1, 0]);
    await open('u3', { ago: 9.5 });
    assert.equal((await tracking.recordLeave(G, 'u3')).quick, true, 'just inside the limit counts as quick');

    // A rejoin after a quick leave is fake (it came back), and its own leave counts for nothing.
    const before = await stats();
    await tracking.recordJoin(G, 'u1', INVITER, 'code', { accountCreatedAt: Date.now() - 400 * 86_400_000 });
    s = await stats();
    assert.deepEqual([s.joins, s.fake], [before.joins, before.fake + 1]);
    assert.equal((await tracking.recordLeave(G, 'u1')).fake, true);
    assert.deepEqual([(await stats()).joins, (await stats()).leaves], [before.joins, before.leaves], 'a fake join leaving changes nothing');

    // With the setting off, the leave is ordinary even when it is quick.
    await tracking.setSettings(G, { quickLeaveMinutes: 0 });
    await open('u4');
    const base = await stats();
    assert.equal((await tracking.recordLeave(G, 'u4')).quick, false);
    s = await stats();
    assert.deepEqual([s.joins, s.leaves], [base.joins, base.leaves + 1]);

    // A member without an inviter has nothing to move.
    await tracking.recordJoin(G, 'u5', null, null, { accountCreatedAt: null, source: 'bot' });
    assert.equal((await pool.query("select source from member_invites where guild_id = $1 and user_id = 'u5'", [G])).rows[0].source, 'bot');
    await tracking.setSettings(G, { quickLeaveMinutes: 60 });
    assert.equal((await tracking.recordLeave(G, 'u5')).quick, false);

    // The total with the leaves taken off (default) and kept in.
    await tracking.addBonus(G, INVITER, 2);
    s = await stats();
    assert.equal(s.total, s.joins - s.leaves + 2);
    assert.equal((await tracking.getLeaderboard(G))[0].net, s.joins - s.leaves + 2);
    await tracking.setSettings(G, { subtractLeaves: false });
    s = await stats();
    assert.equal(s.total, s.joins + 2, 'the leaves stay in the total');
    assert.equal((await tracking.getLeaderboard(G))[0].net, s.joins + 2);
    const week = await tracking.getPeriodLeaderboard(G, 'week');
    assert.equal(week[0].net, week[0].joins, 'the leaderboard of a period follows the setting too');
    await tracking.setSettings(G, { subtractLeaves: true });
    const week2 = await tracking.getPeriodLeaderboard(G, 'week');
    assert.equal(week2[0].net, week2[0].joins - week2[0].leaves);

    console.log('Invite settings database: schema twice, defaults, quick leave (inside, outside, twice, rejoin, no inviter) and the total with both values work.');
  } finally {
    await clean();
    await closePools();
  }
})().catch((err) => { console.error(err); process.exit(1); });
