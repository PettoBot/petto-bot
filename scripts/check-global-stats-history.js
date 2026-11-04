// Checks the daily history of the public stats page (row `history` of `global_stats`): the shape of the row, the GMT-5 day boundary, the days kept as
// they were written, the trim to 120 days, today equal to `totals.today`, the rebuilt days (marked `estimated`, never over a stored day), and that
// the load guard pauses it.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// A fake database: the rows of `global_stats`, the activity, the servers and the flow of members, and a log of every query.
const store = new Map();
const writes = [];
const queries = [];
let activityRows = [];
let guildRows = [];
let flowRows = [];
let failHistoryRead = false;
const totalsToday = { messages: 300, reactions: 30, voice: 3000 };
stub('src/config.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/database.js', {
  from: (table) => ({
    upsert: async (row, options) => {
      writes.push({ table, row, options });
      store.set(row.id, JSON.parse(JSON.stringify(row.data)));
      return { error: null };
    },
  }),
});
stub('src/db/postgres.js', {
  getPrimaryPool: () => ({
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("where id = 'history'")) {
        if (failHistoryRead) throw new Error('database is busy');
        return { rows: store.has('history') ? [{ data: store.get('history') }] : [] };
      }
      if (sql.includes('group by a.day')) return { rows: activityRows };
      if (sql.includes('guild_departures')) return { rows: guildRows };
      if (sql.includes('from member_flow')) return { rows: flowRows.filter((row) => row.day > params[0]) };
      if (sql.includes('global_stats_hidden_users')) return { rows: [] };
      if (sql.includes('count(distinct guild_id)')) {
        return { rows: [{ messages_all: '1000', reactions_all: '90', voice_all: '7200', messages_today: String(totalsToday.messages), reactions_today: String(totalsToday.reactions), voice_today: String(totalsToday.voice), messages_week: '500', reactions_week: '40', voice_week: '3600', guilds: 3 }] };
      }
      return { rows: [] };
    },
  }),
});

const history = require('../src/db/globalStats');
const job = require('../src/jobs/globalStatsJob');

const at = (iso) => new Date(iso);
const guild = (members) => ({ name: 'G', memberCount: members, iconURL: () => null });
const makeClient = (entries) => ({ guilds: { cache: new Map(entries) }, users: { cache: new Map(), fetch: async () => null } });
const clientAB = () => makeClient([['a', guild(100)], ['b', guild(50)]]);
const historyWrites = () => writes.filter((write) => write.row.id === 'history');
const growthQueries = () => queries.filter((query) => query.sql.includes('guild_departures')).length;
const byDay = (data, day) => data.days.find((entry) => entry.day === day);
function reset() {
  store.clear(); writes.length = 0; queries.length = 0; activityRows = []; guildRows = []; flowRows = []; failHistoryRead = false; totalsToday.messages = 300;
  job.resetUsersCache();
}
const run = (client, now) => job.refreshGlobalStats(client, now);

(async () => {
  const live = { servers: 2, members: 150 };
  const totals = { messages: 300, reactions: 30, voiceSeconds: 3000 };

  // The day is the one of Colombia: 04:00 UTC is still the 4th (11 pm), 05:00 UTC starts the 5th.
  const justBefore = history.buildHistory({ now: at('2026-11-05T04:00:00Z'), previous: null, activity: [], todayTotals: totals, live });
  assert.equal(justBefore.days.at(-1).day, '2026-11-04', 'a run at 2026-11-05T04:00Z writes the day 2026-11-04 as today');
  const justAfter = history.buildHistory({ now: at('2026-11-05T05:00:00Z'), previous: justBefore, activity: [], todayTotals: totals, live });
  assert.equal(justAfter.days.at(-1).day, '2026-11-05', 'at 05:00Z a new day starts');
  assert.equal(justAfter.days.at(-2).day, '2026-11-04', 'and the day that ended is still there');

  // The first run: nothing is stored, so the days before are rebuilt and marked estimated. The data is fake and small enough to count by hand.
  reset();
  guildRows = [
    { guild_id: 'a', created_day: '2026-08-01', left_day: null, member_count: 90 },
    { guild_id: 'b', created_day: '2026-10-01', left_day: null, member_count: 45 },
    { guild_id: 'c', created_day: '2026-09-01', left_day: '2026-10-30', member_count: 30 }, // left, not deleted yet: counted until the day it left
    { guild_id: 'ghost', created_day: '2026-09-01', left_day: null, member_count: 5 }, // not in the cache and not marked as left: not known
  ];
  flowRows = [
    { guild_id: 'a', day: '2026-11-04', net: 2 }, { guild_id: 'a', day: '2026-11-03', net: 5 }, { guild_id: 'b', day: '2026-10-20', net: 10 },
  ];
  activityRows = [{ day: '2026-11-03', messages: '5000', reactions: '400', voice_seconds: '9000' }, { day: '2026-11-04', messages: '290', reactions: '29', voice_seconds: '2900' }, { day: '2026-10-01', messages: '10', reactions: '1', voice_seconds: '2' }];
  await run(clientAB(), at('2026-11-04T15:00:00Z'));
  assert.equal(writes.length, 2, 'main and history are written');
  assert.deepEqual(writes.map((write) => write.row.id), ['main', 'history']);
  assert.deepEqual(historyWrites()[0].options, { onConflict: 'id' }, 'the same upsert as main');
  assert.equal(historyWrites()[0].table, 'global_stats');
  let row = store.get('history');
  assert.deepEqual(Object.keys(row).sort(), ['days', 'updatedAt'], 'the shape of the row');
  assert.equal(row.updatedAt, '2026-11-04T15:00:00.000Z');
  assert.equal(new Date(row.updatedAt).toISOString(), row.updatedAt);
  assert.equal(row.days.at(-1).day, '2026-11-04', 'the last day is today');
  assert.equal(row.days[0].day, '2026-08-06', 'it goes back 90 days from today');
  assert.equal(row.days.length, 91, '90 days before today and today');
  const sorted = row.days.map((entry) => entry.day);
  assert.deepEqual(sorted, [...sorted].sort(), 'oldest first');
  assert.equal(new Set(sorted).size, sorted.length, 'one entry for each day');
  for (const entry of row.days) {
    assert.deepEqual(Object.keys(entry).filter((key) => key !== 'estimated').sort(), ['day', 'members', 'messages', 'reactions', 'servers', 'voiceSeconds']);
    assert.ok(entry.estimated === undefined || entry.estimated === true, 'estimated is true or not there');
    for (const key of ['messages', 'reactions', 'voiceSeconds']) assert.ok(Number.isInteger(entry[key]) && entry[key] >= 0);
  }
  const today = byDay(row, '2026-11-04');
  assert.deepEqual(today, { day: '2026-11-04', servers: 2, members: 150, messages: 300, reactions: 30, voiceSeconds: 3000 }, 'today is the live numbers and exactly totals.today');
  assert.equal(today.estimated, undefined, 'today is not an estimate');
  // Members: today's count of each server minus the joins less the leaves of the days after.
  assert.deepEqual(byDay(row, '2026-11-03'), { day: '2026-11-03', servers: 2, members: 148, messages: 5000, reactions: 400, voiceSeconds: 9000, estimated: true }, 'a: 100 - 2, b: 50');
  assert.equal(byDay(row, '2026-11-02').members, 143, 'a: 100 - (2 + 5), b: 50');
  assert.deepEqual([byDay(row, '2026-10-29').servers, byDay(row, '2026-10-29').members], [3, 173], 'the server that left on the 30th is still counted on the 29th, with its last known members');
  assert.deepEqual([byDay(row, '2026-10-30').servers, byDay(row, '2026-10-30').members], [2, 143], 'and not on the day it left');
  assert.deepEqual([byDay(row, '2026-10-19').servers, byDay(row, '2026-10-19').members], [3, 163], 'b had 10 members less before the 20th: a 93, b 40, c 30');
  assert.deepEqual([byDay(row, '2026-09-30').servers, byDay(row, '2026-09-30').members], [2, 123], 'b did not exist yet: only a (93) and c (30)');
  assert.equal(byDay(row, '2026-10-01').messages, 10, 'the messages of a past day come from the activity of the database');
  assert.ok(row.days.slice(0, -1).every((entry) => entry.estimated === true), 'every rebuilt day is marked');
  assert.equal(growthQueries(), 1, 'the servers were read once');

  // The next run (10 minutes later): the days that were written stay as they were, nothing is rebuilt and today follows the live numbers.
  const frozen = JSON.parse(JSON.stringify(row.days.slice(0, -1)));
  guildRows = []; flowRows = []; // were the old days read again they would turn into nulls
  activityRows = activityRows.filter((entry) => entry.day !== '2026-10-01'); // messages follow the database, servers and members do not
  totalsToday.messages = 310;
  await run(makeClient([['a', guild(101)], ['b', guild(51)], ['d', guild(9)]]), at('2026-11-04T15:10:00Z'));
  row = store.get('history');
  assert.equal(historyWrites().length, 2);
  assert.equal(growthQueries(), 1, 'nothing is rebuilt when the days are there');
  assert.deepEqual(row.days.slice(0, -1).map(({ servers, members, estimated, day }) => ({ servers, members, estimated, day })), frozen.map(({ servers, members, estimated, day }) => ({ servers, members, estimated, day })), 'earlier days are frozen as they were written');
  assert.deepEqual(byDay(row, '2026-11-04'), { day: '2026-11-04', servers: 3, members: 161, messages: 310, reactions: 30, voiceSeconds: 3000 }, 'today moves with the live numbers and with totals.today');
  assert.equal(byDay(row, '2026-10-01').messages, 0, 'the activity of a day is the one of the database');

  // The history is written at most every 10 minutes.
  const before = historyWrites().length;
  await run(clientAB(), at('2026-11-04T15:15:00Z'));
  assert.equal(historyWrites().length, before, 'not again 5 minutes later');
  assert.equal(writes.filter((write) => write.row.id === 'main').length, 3, 'main is written on every run');
  await run(clientAB(), at('2026-11-04T15:20:00Z'));
  assert.equal(historyWrites().length, before + 1, 'again after 10 minutes');

  // The day changes: the day that ended keeps the last numbers written for it and a new day starts, with no rebuilding.
  const endOfDay = byDay(store.get('history'), '2026-11-04');
  await run(clientAB(), at('2026-11-05T05:00:00Z'));
  row = store.get('history');
  assert.equal(row.days.at(-1).day, '2026-11-05'); assert.equal(row.days.length, 92);
  assert.deepEqual(byDay(row, '2026-11-04'), { ...endOfDay, messages: 290, reactions: 29, voiceSeconds: 2900 }, 'yesterday keeps its servers and members (its numbers of activity are the ones of the database), and is not marked as an estimate');
  assert.equal(byDay(row, '2026-11-04').estimated, undefined);
  assert.equal(growthQueries(), 1);

  // Holes: a stored day is never replaced by an estimate; only the missing days between stored ones are rebuilt.
  reset();
  guildRows = [{ guild_id: 'a', created_day: '2026-08-01', left_day: null, member_count: 90 }, { guild_id: 'b', created_day: '2026-08-01', left_day: null, member_count: 45 }];
  store.set('history', { days: [
    { day: '2026-10-30', servers: 7, members: 70, messages: 1, reactions: 1, voiceSeconds: 1 },
    { day: '2026-11-01', servers: 8, members: 80, messages: 1, reactions: 1, voiceSeconds: 1, estimated: true },
    { day: '2026-11-02', servers: 9, members: 90, messages: 1, reactions: 1, voiceSeconds: 1 },
  ], updatedAt: '2026-11-02T10:00:00.000Z' });
  await run(clientAB(), at('2026-11-04T15:00:00Z'));
  row = store.get('history');
  assert.equal(row.days[0].day, '2026-10-30', 'the days before the first stored one are not invented once there is a snapshot');
  assert.deepEqual([byDay(row, '2026-10-30').servers, byDay(row, '2026-10-30').members, byDay(row, '2026-10-30').estimated], [7, 70, undefined], 'a stored day is kept');
  assert.deepEqual([byDay(row, '2026-11-01').servers, byDay(row, '2026-11-01').members, byDay(row, '2026-11-01').estimated], [8, 80, true], 'a stored estimate is kept as it was');
  assert.deepEqual([byDay(row, '2026-11-02').servers, byDay(row, '2026-11-02').members], [9, 90]);
  assert.deepEqual([byDay(row, '2026-10-31').servers, byDay(row, '2026-10-31').members, byDay(row, '2026-10-31').estimated], [2, 150, true], 'a hole is rebuilt and marked');
  assert.deepEqual([byDay(row, '2026-11-03').servers, byDay(row, '2026-11-03').members, byDay(row, '2026-11-03').estimated], [2, 150, true], 'the day the bot did not write is rebuilt too');
  assert.equal(byDay(row, '2026-11-04').estimated, undefined);

  // Not enough data to be honest: nothing is invented (null, not zero, and no estimate mark).
  reset();
  await run(clientAB(), at('2026-11-04T15:00:00Z'));
  row = store.get('history');
  assert.deepEqual(row.days, [{ day: '2026-11-04', servers: 2, members: 150, messages: 300, reactions: 30, voiceSeconds: 3000 }], 'with no server known there are no estimated days');
  activityRows = [{ day: '2026-11-02', messages: '12', reactions: '1', voice_seconds: '5' }];
  store.clear();
  job.resetUsersCache();
  await run(clientAB(), at('2026-11-04T15:00:00Z'));
  row = store.get('history');
  assert.deepEqual(byDay(store.get('history'), '2026-11-02'), { day: '2026-11-02', servers: null, members: null, messages: 12, reactions: 1, voiceSeconds: 5 }, 'a day with activity and no servers is null, not 0');
  assert.deepEqual(byDay(row, '2026-11-03'), { day: '2026-11-03', servers: null, members: null, messages: 0, reactions: 0, voiceSeconds: 0 });

  // At most 120 days, ending with today.
  reset();
  const stored = Array.from({ length: 130 }, (_, n) => ({ day: history.dayShift('2026-11-03', n - 129), servers: 100 + n, members: 1000 + n, messages: 1, reactions: 1, voiceSeconds: 1 }));
  store.set('history', { days: stored, updatedAt: '2026-11-03T10:00:00.000Z' });
  await run(clientAB(), at('2026-11-04T15:00:00Z'));
  row = store.get('history');
  assert.equal(row.days.length, 120, 'trimmed to 120 days');
  assert.equal(row.days[0].day, '2026-07-08'); assert.equal(row.days.at(-1).day, '2026-11-04');
  assert.equal(row.days.at(-2).servers, 229, 'and the newest stored days stay');

  // A failure of the history never stops main, and it is tried again on the next run.
  reset();
  failHistoryRead = true;
  await run(clientAB(), at('2026-11-04T15:00:00Z'));
  assert.deepEqual(writes.map((write) => write.row.id), ['main'], 'main is saved even if the history fails');
  failHistoryRead = false;
  await run(clientAB(), at('2026-11-04T15:01:00Z'));
  assert.deepEqual(writes.map((write) => write.row.id), ['main', 'main', 'history'], 'the history is tried again one minute later');

  // A bot that has not loaded its servers writes no history (and does not count that as a run).
  reset();
  await run(makeClient([]), at('2026-11-04T15:00:00Z'));
  assert.deepEqual(writes.map((write) => write.row.id), ['main']);
  await run(clientAB(), at('2026-11-04T15:01:00Z'));
  assert.equal(historyWrites().length, 1);

  // The queries are read-only and added up by the database.
  assert.ok(queries.every(({ sql }) => !/\b(insert|update|delete)\b/i.test(sql)), 'only reads');
  const activitySql = queries.find(({ sql }) => sql.includes('group by a.day')).sql;
  assert.ok(activitySql.includes('from activity_stats') && !activitySql.includes('guilds'), 'the same servers as totals: every server with activity');
  assert.ok(activitySql.includes('sum(a.messages)') && activitySql.includes("'America/Bogota'") && activitySql.includes('120'), 'added up by day in GMT-5 over 120 days');

  // The load guard pauses the tick of the job, and with it the history (the same way as it pauses main).
  reset();
  const loadGuard = require('../src/utils/loadGuard');
  const perf = require('../src/utils/perf');
  const ticks = [];
  const realSetInterval = global.setInterval;
  const realSetTimeout = global.setTimeout;
  global.setInterval = (callback) => { ticks.push(callback); return { unref() {} }; };
  global.setTimeout = () => ({ unref() {} });
  perf.trackIntervals();
  try {
    job.startGlobalStatsJob(clientAB());
  } finally { global.setTimeout = realSetTimeout; }
  assert.equal(ticks.length, 1, 'the job has one interval');
  const settle = async () => { for (let n = 0; n < 20; n += 1) await new Promise((resolve) => setImmediate(resolve)); };
  loadGuard.reset();
  loadGuard.force('degraded');
  ticks[0](); await settle();
  assert.equal(writes.length, 0, 'degraded: neither main nor history is written');
  loadGuard.force('normal');
  ticks[0](); await settle();
  assert.deepEqual(writes.map((write) => write.row.id), ['main', 'history'], 'normal: both are written');
  loadGuard.reset();
  global.setInterval = realSetInterval;

  console.log('Checked the global stats history: the row, the GMT-5 day, the frozen days, the 120 days, today as totals.today, the rebuilt days and the load guard.');
})().catch((error) => { console.error(error); process.exit(1); });
