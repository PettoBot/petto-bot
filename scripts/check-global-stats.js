// Checks the global stats: the ranking of the servers that chose to be in it, the growth rates, and the job that saves
// one row for the public page.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const saved = [];
const queries = [];
stub('src/config.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/db/database.js', { from: (table) => ({ upsert: async (row, options) => { saved.push({ table, row, options }); return { error: null }; } }) });
stub('src/db/postgres.js', {
  getPrimaryPool: () => ({
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('global_stats_users')) return { rows: [{ user_id: 'u1', messages: '500', voice_seconds: '3600' }, { user_id: 'u2', messages: '900', voice_seconds: '60' }, { user_id: 'ghost', messages: '9999', voice_seconds: '9999' }] };
      if (sql.includes('count(distinct guild_id)')) return { rows: [{ messages_all: '1000', reactions_all: '90', voice_all: '7200', messages_today: '100', reactions_today: '9', voice_today: '720', messages_week: '500', reactions_week: '40', voice_week: '3600', guilds: 12 }] };
      return { rows: [{ guild_id: 'a', messages_all: '800', reactions_all: '5', voice_all: '600', messages_week: '80', reactions_week: '1', voice_week: '60' }, { guild_id: 'gone', messages_all: '900', reactions_all: '5', voice_all: '600', messages_week: '90', reactions_week: '1', voice_week: '60' }] };
    },
  }),
});
const { buildRanking, buildUserRanking, buildRates, SERVER_RANK_SIZE, USER_RANK_SIZE } = require('../src/db/globalStats');

const server = (id, all, week) => ({ id, all: { messages: all, reactions: all / 2, voiceSeconds: all * 10 }, week: { messages: week, reactions: 0, voiceSeconds: week * 10 } });
const servers = Array.from({ length: 14 }, (_, n) => server(`g${n}`, (n + 1) * 100, n % 3 === 0 ? 0 : n * 10));
const known = new Map(servers.map((entry, n) => [entry.id, { name: `Server ${n}`, icon: n % 2 ? 'https://cdn.example/i.png' : null }]));
known.delete('g13');

const ranking = buildRanking(servers, (id) => known.get(id) ?? null);
assert.equal(SERVER_RANK_SIZE, 3); assert.equal(USER_RANK_SIZE, 10);
assert.equal(ranking.all.messages.length, 3, 'the server ranking holds the top 3 only');
assert.equal(ranking.all.messages[0].id, 'g12', 'a server the bot no longer has is left out, and the biggest one leads');
assert.deepEqual(ranking.all.messages.map((entry) => entry.value), [...ranking.all.messages.map((entry) => entry.value)].sort((a, b) => b - a), 'sorted from most to least');
assert.ok(ranking.week.messages.every((entry) => entry.value > 0), 'a server with no activity in the week is not in the weekly ranking');
assert.equal(ranking.all.voiceSeconds[0].value, 13000, 'voice has its own ranking');
assert.deepEqual(Object.keys(ranking.week), ['messages', 'reactions', 'voiceSeconds']);
assert.equal(ranking.all.messages[0].icon, null);
assert.equal(ranking.all.messages[1].name, 'Server 11');

const noon = new Date(Date.UTC(2026, 9, 3, 12, 0, 0));
const rates = buildRates({ messages: 43200, reactions: 4320, voiceSeconds: 86400 }, noon);
assert.deepEqual(rates, { messages: 1, reactions: 0.1, voiceSeconds: 2 }, 'a rate is the numbers of today over the seconds of today');
const justAfterMidnight = buildRates({ messages: 900, reactions: 0, voiceSeconds: 0 }, new Date(Date.UTC(2026, 9, 3, 0, 0, 5)));
assert.equal(justAfterMidnight.messages, 1, 'the first minutes of the day do not make a huge rate');

(async () => {
  const { refreshGlobalStats } = require('../src/jobs/globalStatsJob');
  const guild = { name: 'Alpha', iconURL: () => 'https://cdn.example/a.png' };
  const people = { u1: { globalName: 'Una', username: 'u1', displayAvatarURL: () => 'https://cdn.example/u1.png' }, u2: { globalName: null, username: 'dos', displayAvatarURL: () => 'https://cdn.example/u2.png' } };
  await refreshGlobalStats({ guilds: { cache: new Map([['a', guild], ['b', guild]]) }, users: { cache: new Map(Object.entries(people)), fetch: async () => { throw new Error('unknown user'); } } });
  assert.equal(saved.length, 1); assert.equal(saved[0].table, 'global_stats'); assert.equal(saved[0].row.id, 'main'); assert.deepEqual(saved[0].options, { onConflict: 'id' });
  const data = saved[0].row.data;
  assert.deepEqual(data.totals.all, { messages: 1000, reactions: 90, voiceSeconds: 7200 }); assert.deepEqual(data.totals.week, { messages: 500, reactions: 40, voiceSeconds: 3600 }); assert.equal(data.totals.guilds, 12);
  assert.equal(data.servers, 2);
  assert.deepEqual(data.ranking.all.messages, [{ id: 'a', name: 'Alpha', icon: 'https://cdn.example/a.png', value: 800 }], 'only a server the bot still has is named');
  assert.ok(queries.some((sql) => sql.includes('g.global_stats_visible')), 'only the servers that chose to be ranked are read for the ranking');
  assert.ok(data.rates.messages >= 0);
  assert.deepEqual(data.users.messages.map((u) => [u.id, u.name, u.value]), [['u2', 'dos', 900], ['u1', 'Una', 500]], 'users who opted in are ranked with their name, and one that cannot be found is left out');
  assert.deepEqual(data.users.voiceSeconds.map((u) => u.id), ['u1', 'u2']);
  assert.ok(queries.some((sql) => sql.includes('join level_users') && sql.includes('global_stats_users')), 'only the users who opted in are read');
  const many = Array.from({ length: 30 }, (_, n) => ({ id: `u${n}`, messages: n + 1, voiceSeconds: 0 }));
  const top = buildUserRanking(many, (id) => ({ name: id }));
  assert.equal(top.messages.length, 10, 'the user ranking holds the top 10'); assert.equal(top.messages[0].id, 'u29'); assert.equal(top.voiceSeconds.length, 0, 'someone with no voice time is not in the voice ranking');
  console.log('Checked the global stats: the ranking, the servers left out, the growth rates and the saved row.');
})().catch((error) => { console.error(error); process.exit(1); });
//: the ranking, the servers left out and the growth rates.');
