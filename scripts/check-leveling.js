// Checks the leveling rules (anti-abuse, XP events, daily bonus, periods) and, when PETTO_TEST_DATABASE_URL points at a
// PostgreSQL database that has schema.sql applied, the queries behind the streak, the events and the weekly and monthly
// rankings. Without that variable the database part is skipped, so `npm run check` needs no database.
const assert = require('node:assert/strict');
const path = require('node:path');
const rules = require('../src/utils/levelRules');

// ---- the rules ----
assert.deepEqual(rules.periodKeys(new Date('2026-10-02T10:00:00Z')), { week: '2026-W40', month: '2026-10' });
assert.deepEqual(rules.periodKeys(new Date('2026-12-31T23:00:00Z')), { week: '2026-W53', month: '2026-12' });
assert.equal(rules.periodKeys(new Date('2027-01-01T00:00:00Z')).week, '2026-W53', 'the first days of January can belong to the last ISO week');
assert.equal(rules.periodKeys(new Date('2026-01-05T00:00:00Z')).week, '2026-W02');
assert.equal(rules.utcDay(new Date('2026-10-02T23:59:59Z')), '2026-10-02');

assert.equal(rules.meaningfulText('hi <@123> https://x.test/a <:smile:456> ok'), 'hiok');
assert.equal(rules.longEnough('a', { min_message_chars: 3 }), false);
assert.equal(rules.longEnough('hey', { min_message_chars: 3 }), true);
assert.equal(rules.longEnough('https://spam.test <@1>', { min_message_chars: 3 }), false, 'links and mentions do not count as text');
assert.equal(rules.longEnough('', { min_message_chars: 0 }), true, 'a setting of 0 lets everything through');

let clock = 1_000_000;
const isRepeat = rules.createRepeatGuard(() => clock);
assert.equal(isRepeat('g:u', 'Hello there'), false);
clock += 10_000;
assert.equal(isRepeat('g:u', 'hello there '), true, 'the same text again is a repeat, in any case');
clock += 10_000;
assert.equal(isRepeat('g:u', 'hello there'), true, 'a repeat does not keep the window open');
clock = 1_000_000 + 61_000;
assert.equal(isRepeat('g:u', 'hello there'), false, 'after a minute it counts again');
assert.equal(isRepeat('g:other', 'hello there'), false, 'another member is not a repeat');
assert.equal(isRepeat('g:u', 'something else'), false);

const now = new Date('2026-10-10T12:00:00Z');
const events = [
  { source: 'all', multiplier: '2', starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-10-11T00:00:00Z' },
  { source: 'voice', multiplier: '3', starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-10-11T00:00:00Z' },
  { source: 'text', multiplier: '5', starts_at: '2026-10-12T00:00:00Z', ends_at: '2026-10-13T00:00:00Z' },
  { source: 'all', multiplier: '4', starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-05T00:00:00Z' },
];
assert.equal(rules.eventMultiplier(events, 'text', now), 2, 'only running events count, text ones for text');
assert.equal(rules.eventMultiplier(events, 'voice', now), 3, 'the highest running event wins');
assert.equal(rules.eventMultiplier([], 'text', now), 1);
assert.equal(rules.eventMultiplier(events, 'text', new Date('2026-10-11T00:00:00Z')), 1, 'an event ends at its end time');

assert.equal(rules.dailyBonus({ daily_bonus_xp: 50, streak_bonus_xp: 10, streak_max_days: 7 }, 1), 50);
assert.equal(rules.dailyBonus({ daily_bonus_xp: 50, streak_bonus_xp: 10, streak_max_days: 7 }, 4), 80);
assert.equal(rules.dailyBonus({ daily_bonus_xp: 50, streak_bonus_xp: 10, streak_max_days: 7 }, 30), 110, 'the streak bonus stops at the cap');
assert.equal(rules.dailyBonus({ daily_bonus_xp: 0, streak_bonus_xp: 0 }, 9), 0);

assert.equal(rules.voiceEligible({ humans: 1, deaf: false, muted: false }, { voice_min_members: 2 }), false, 'alone in a channel earns nothing');
assert.equal(rules.voiceEligible({ humans: 2, deaf: false, muted: false }, { voice_min_members: 2 }), true);
assert.equal(rules.voiceEligible({ humans: 3, deaf: true, muted: false }, { voice_min_members: 2 }), false, 'deafened earns nothing');
assert.equal(rules.voiceEligible({ humans: 3, deaf: false, muted: true }, { voice_min_members: 2, voice_ignore_muted: true }), false);
assert.equal(rules.voiceEligible({ humans: 3, deaf: false, muted: true }, { voice_min_members: 2 }), true, 'muted counts unless the server turns that on');
assert.equal(rules.voiceEligible({ humans: 1, deaf: false, muted: false }, {}), true, 'with no settings a single person is enough, as before');

async function databaseChecks(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url });
  const stub = (relative, exports) => {
    const resolved = require.resolve(path.join(__dirname, '..', relative));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };
  stub('src/db/postgres.js', { getPrimaryPool: () => pool });
  stub('src/db/database.js', {});
  const levelUsers = require('../src/db/levelUsers');
  const periods = require('../src/db/levelPeriods');
  const events = require('../src/db/xpEvents');

  const guild = '900000000000000001';
  await pool.query('delete from guilds where guild_id = $1', [guild]);
  await pool.query('insert into guilds (guild_id) values ($1)', [guild]);

  // Streak: first day, same day again, the next day, then a gap.
  await pool.query('insert into level_users (guild_id, user_id) values ($1, $2)', [guild, 'u1']);
  assert.deepEqual(await levelUsers.touchStreak(guild, 'u1', '2026-10-01'), { newDay: true, streak: 1 });
  assert.deepEqual(await levelUsers.touchStreak(guild, 'u1', '2026-10-01'), { newDay: false, streak: 1 }, 'the same day is not a new day');
  assert.deepEqual(await levelUsers.touchStreak(guild, 'u1', '2026-10-02'), { newDay: true, streak: 2 });
  assert.deepEqual(await levelUsers.touchStreak(guild, 'u1', '2026-10-03'), { newDay: true, streak: 3 });
  assert.deepEqual(await levelUsers.touchStreak(guild, 'u1', '2026-10-09'), { newDay: true, streak: 1 }, 'a gap restarts the streak');
  const row = (await pool.query('select streak, best_streak from level_users where guild_id = $1 and user_id = $2', [guild, 'u1'])).rows[0];
  assert.deepEqual([row.streak, row.best_streak], [1, 3], 'the best streak is kept');
  assert.deepEqual(await levelUsers.touchStreak(guild, 'nobody', '2026-10-01'), { newDay: false, streak: 0 }, 'a member with no row is left alone');

  // Weekly and monthly boards.
  const at = new Date('2026-10-14T10:00:00Z');
  await periods.addPeriodXp(guild, 'u1', { textXp: 100 }, at);
  await periods.addPeriodXp(guild, 'u1', { textXp: 50, voiceXp: 20 }, at);
  await periods.addPeriodXp(guild, 'u2', { textXp: 400 }, at);
  await periods.addPeriodXp(guild, 'u3', { voiceXp: 900 }, at);
  await periods.addPeriodXp(guild, 'u1', { textXp: 7000 }, new Date('2026-09-01T10:00:00Z'));
  assert.deepEqual(await periods.boardPage(guild, 'week', 'text', { offset: 0, limit: 10 }, at), [{ user_id: 'u2', xp: 400 }, { user_id: 'u1', xp: 150 }]);
  assert.deepEqual(await periods.boardPage(guild, 'month', 'voice', { offset: 0, limit: 10 }, at), [{ user_id: 'u3', xp: 900 }, { user_id: 'u1', xp: 20 }]);
  assert.equal(await periods.boardCount(guild, 'week', 'text', at), 2);
  assert.equal(await periods.boardCount(guild, 'month', 'text', new Date('2026-09-15T00:00:00Z')), 1, 'another month has its own board');
  assert.deepEqual(await periods.memberStanding(guild, 'u1', 'week', 'text', at), { xp: 150, position: 2 });
  assert.equal(await periods.memberStanding(guild, 'u3', 'week', 'text', at), null, 'no XP in that source means no standing');
  assert.deepEqual(await periods.boardPage(guild, 'week', 'text', { offset: 1, limit: 1 }, at), [{ user_id: 'u1', xp: 150 }], 'paging works');
  await periods.pruneOldPeriods(new Date('2028-06-01T00:00:00Z'));
  assert.equal(await periods.boardCount(guild, 'month', 'text', at), 0, 'old periods are pruned');

  // Events.
  const soon = new Date(Date.now() + 3_600_000);
  const later = new Date(Date.now() + 7_200_000);
  const added = await events.addEvent(guild, { name: 'Double XP', multiplier: 2, source: 'all', startsAt: soon, endsAt: later }, 'tester');
  assert.equal(added.ok, true);
  assert.equal((await events.listEvents(guild, { force: true })).length, 1);
  await assert.rejects(pool.query("insert into xp_events (guild_id, name, multiplier, starts_at, ends_at) values ($1, 'bad', 2, now(), now() - interval '1 hour')", [guild]), 'an event cannot end before it starts');
  assert.equal(await events.removeEvent(guild, added.event.id), true);
  assert.equal(await events.removeEvent(guild, 'abc'), false);
  assert.equal((await events.listEvents(guild, { force: true })).length, 0);
  for (let i = 0; i < events.MAX_EVENTS; i += 1) await events.addEvent(guild, { name: `e${i}`, multiplier: 1.5, source: 'text', startsAt: soon, endsAt: later });
  assert.equal((await events.addEvent(guild, { name: 'one too many', multiplier: 2, source: 'all', startsAt: soon, endsAt: later })).code, 'limit');

  await pool.query('delete from guilds where guild_id = $1', [guild]);
  await pool.end();
  return true;
}

(async () => {
  const url = process.env.PETTO_TEST_DATABASE_URL;
  if (url) await databaseChecks(url);
  console.log(`Checked the leveling rules${url ? ', the streak, the rankings by period and the XP events on a database' : ' (set PETTO_TEST_DATABASE_URL to check the queries too)'}.`);
})().catch((error) => { console.error(error); process.exit(1); });
