// What counts for a streak when a server filters it: the rules (length, cooldown, channels, roles, reactions), the day each counted message goes to, the batches that are written and, with
// PETTO_TEST_DATABASE_URL, the real days a streak reads (activity_members until the server started to filter, the counted days from then on).
const assert = require('node:assert/strict');
const path = require('node:path');
const stubAt = (file, exports) => { const full = require.resolve(path.join('..', 'src', file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
const statsRules = { allowed: () => ({ members: true }) };
stubAt('db/statsRules.js', statsRules);
let pool = null;
const real = process.env.PETTO_TEST_DATABASE_URL;
if (real) { const { Pool } = require('pg'); pool = new Pool({ connectionString: real }); }
const written = [];
stubAt('db/postgres.js', { getPrimaryPool: () => pool ?? { query: async (sql, params) => { written.push({ sql, params }); return { rows: [] }; } } });
const counts = require('../src/db/streakCounts');
const counting = require('../src/utils/streakCounting');
const G = '910000000000000011';
const CH1 = '810000000000000001', CH2 = '810000000000000002', CAT = '810000000000000003', ROLE_A = '710000000000000001', ROLE_B = '710000000000000002';
const row = (patch) => ({ min_length: 0, cooldown_seconds: 0, channel_mode: 'all', channel_ids: [], role_mode: 'all', role_ids: [], reactions_count: false, ...patch });
const base = (extra = {}) => ({ guildId: G, userId: '1', length: 30, channelIds: [CH1], roleIds: [], ...extra });
(async () => {
  // The rules of a row: a list with nothing in it is no rule, bad ids and out-of-range numbers are cleaned.
  assert.equal(counts.filtering(counts.filtersOf(row({}))), false);
  assert.equal(counts.filtersOf(row({ channel_mode: 'only', channel_ids: [] })).channelMode, 'all', 'only nothing is everywhere');
  assert.deepEqual(counts.filtersOf(row({ channel_mode: 'except', channel_ids: [CH1, 'x', 5] })).channelIds, [CH1]);
  assert.equal(counts.filtersOf(row({ min_length: 9999 })).minLength, 500); assert.equal(counts.filtersOf(row({ cooldown_seconds: -4 })).cooldownSeconds, 0);
  assert.equal(counts.filtering(counts.filtersOf(row({ reactions_count: true }))), true);
  const queued = [];
  const q = (g, u, d) => queued.push([g, u, d]);
  const at = new Date('2026-11-20T04:00:00Z').getTime(); // 23:00 of the 19th in Colombia
  // Length: a short message and a reaction under a rule of length.
  let f = counts.filtersOf(row({ min_length: 10 }));
  assert.equal(counting.consider(f, base({ length: 9, at }), q), false); assert.equal(counting.consider(f, base({ length: 10, at, userId: '2' }), q), true);
  assert.equal(counting.consider(f, base({ length: null, at, userId: '3' }), q), true, 'a reaction has no length to ask');
  assert.deepEqual(queued.map((x) => x[2]), ['2026-11-19', '2026-11-19'], 'the day is the one of Colombia');
  // Channels: only some, or everywhere but some; a thread or a category counts through its parent.
  f = counts.filtersOf(row({ channel_mode: 'only', channel_ids: [CH1, CAT] }));
  assert.equal(counting.consider(f, base({ channelIds: [CH2], userId: '4', at }), q), false);
  assert.equal(counting.consider(f, base({ channelIds: [CH2, CAT], userId: '4', at }), q), true, 'its category is one of them');
  f = counts.filtersOf(row({ channel_mode: 'except', channel_ids: [CH1] }));
  assert.equal(counting.consider(f, base({ channelIds: [CH1], userId: '5', at }), q), false); assert.equal(counting.consider(f, base({ channelIds: [CH2], userId: '5', at }), q), true);
  // Roles.
  f = counts.filtersOf(row({ role_mode: 'only', role_ids: [ROLE_A] }));
  assert.equal(counting.consider(f, base({ roleIds: [ROLE_B], userId: '6', at }), q), false); assert.equal(counting.consider(f, base({ roleIds: [ROLE_B, ROLE_A], userId: '6', at }), q), true);
  f = counts.filtersOf(row({ role_mode: 'except', role_ids: [ROLE_A] }));
  assert.equal(counting.consider(f, base({ roleIds: [ROLE_A], userId: '7', at }), q), false); assert.equal(counting.consider(f, base({ roleIds: [], userId: '7', at }), q), true);
  // Cooldown: one counted message every 60 seconds for each person in each server; a message that did not count does not start it.
  f = counts.filtersOf(row({ cooldown_seconds: 60, min_length: 5 }));
  const n = queued.length;
  assert.equal(counting.consider(f, base({ userId: '8', at }), q), true);
  assert.equal(counting.consider(f, base({ userId: '8', at: at + 30_000 }), q), false, 'inside the minute');
  assert.equal(counting.consider(f, base({ userId: '8', at: at + 61_000 }), q), true, 'after it');
  assert.equal(counting.consider(f, base({ userId: '9', length: 1, at }), q), false); assert.equal(counting.consider(f, base({ userId: '9', at: at + 1000 }), q), true, 'a short one did not start the cooldown');
  assert.equal(counting.consider(f, base({ userId: '8', guildId: 'other', at: at + 1000 }), q), true, 'each server has its own');
  assert.equal(queued.length - n, 4);
  // The rules of the servers: a server that does not filter has none.
  counting.setForTests(new Map([[G, counts.filtersOf(row({ min_length: 3 }))]]));
  assert.equal(counting.rulesOf(G).minLength, 3); assert.equal(counting.rulesOf('nobody'), undefined);
  // The events: bots, webhooks, people who asked not to be counted and servers that do not filter add nothing.
  const optOut = new Set(['11']);
  const originalAllowed = statsRules.allowed; statsRules.allowed = (g, u) => (optOut.has(u) ? { members: false } : { members: true });
  const msg = require('../src/events/messageCreateStreakCount');
  const react = require('../src/events/messageReactionAddStreakCount');
  const before = counts.waiting();
  const message = (over = {}) => ({ author: { bot: false, id: '10' }, guild: { id: G }, content: 'long enough', channelId: CH1, channel: { parentId: null, parent: null }, member: { roles: { cache: new Map([[ROLE_A, {}]]) } }, ...over });
  msg.execute(message({ author: { bot: true, id: '10' } })); msg.execute(message({ webhookId: '5' })); msg.execute(message({ guild: null })); msg.execute(message({ guild: { id: 'nobody' } }));
  msg.execute(message({ author: { bot: false, id: '11' } })); msg.execute(message({ content: 'no' }));
  assert.equal(counts.waiting(), before, 'none of those counted');
  msg.execute(message()); assert.equal(counts.waiting(), before + 1, 'a good message waits to be written');
  // Reactions count only when the server asked for it.
  const reaction = (over = {}) => ({ message: { guildId: G, channelId: CH1, channel: { parentId: null } }, client: { guilds: { cache: new Map() } }, ...over });
  await react.execute(reaction(), { bot: false, id: '12' }); assert.equal(counts.waiting(), before + 1, 'reactions are off');
  counting.setForTests(new Map([[G, counts.filtersOf(row({ reactions_count: true, cooldown_seconds: 30 }))]]));
  await react.execute(reaction(), { bot: false, id: '12' }); assert.equal(counts.waiting(), before + 2, 'a reaction counted');
  await react.execute(reaction(), { bot: false, id: '12' }); assert.equal(counts.waiting(), before + 2, 'the cooldown applies to reactions too');
  await react.execute(reaction(), { bot: true, id: '13' }); await react.execute(reaction(), { bot: false, id: '11' });
  assert.equal(counts.waiting(), before + 2, 'bots and people who opted out do not count');
  // With a rule of roles the member is asked for; one that cannot be found is not counted.
  counting.setForTests(new Map([[G, counts.filtersOf(row({ reactions_count: true, role_mode: 'only', role_ids: [ROLE_A] }))]]));
  const guild = { members: { cache: new Map(), fetch: async (id) => { if (id === '15') throw new Error('gone'); return { roles: { cache: new Map([[ROLE_A, {}]]) } }; } } };
  const withGuild = reaction({ client: { guilds: { cache: new Map([[G, guild]]) } } });
  await react.execute(withGuild, { bot: false, id: '14' }); assert.equal(counts.waiting(), before + 3, 'the member was fetched and has the role');
  await react.execute(withGuild, { bot: false, id: '15' }); assert.equal(counts.waiting(), before + 3, 'a member who is not found does not count');
  statsRules.allowed = originalAllowed;
  // The batch: one insert with the arrays; what fails stays.
  await counts.flush();
  if (!real) {
    const w = written.at(-1); assert.match(w.sql, /insert into streak_days/); assert.match(w.sql, /on conflict \(guild_id, user_id, day\) do update set messages = streak_days.messages \+ excluded.messages/);
    assert.equal(w.params[0].length, w.params[1].length); assert.equal(counts.waiting(), 0);
  }
  if (real) {
    // The real database: the days a streak reads.
    const streaks = require('../src/db/streaks');
    await pool.query("insert into guilds (guild_id) values ($1) on conflict do nothing", [G]);
    for (const table of ['activity_members', 'streak_days', 'streak_config']) await pool.query(`delete from ${table} where guild_id = $1`, [G]);
    await pool.query("insert into activity_members (guild_id, user_id, day, messages, voice_seconds) values ($1,'u1',current_date-5,10,0),($1,'u1',current_date-3,10,0),($1,'u1',current_date-2,4,90),($1,'u1',current_date-1,3,0),($1,'u2',current_date-1,9,0)", [G]);
    await pool.query("insert into streak_config (guild_id) values ($1)", [G]);
    await pool.query("insert into streak_days (guild_id, user_id, day, messages) values ($1,'u1',current_date-1,99),($1,'u3',current_date,5)", [G]);
    assert.deepEqual((await streaks.daysOf(G, 'u1')).map((d) => d.messages), [10, 10, 4, 3], 'before the server filters: activity_members, a counted day is ignored');
    await pool.query("update streak_config set counting_since = current_date-2 where guild_id = $1", [G]);
    await pool.query("insert into streak_days (guild_id, user_id, day, messages) values ($1,'u1',current_date-2,1),($1,'u2',current_date,2)", [G]);
    assert.deepEqual((await streaks.daysOf(G, 'u1')).map((d) => [d.messages, d.voiceSeconds]), [[10, 0], [10, 0], [1, 90], [99, 0]], 'from the day it started: the counted days, with the voice of activity_members');
    const many = await streaks.daysOfMany(G, ['u1', 'u2', 'u3']);
    assert.deepEqual(many.get('u2').map((d) => d.messages), [0, 2]); assert.deepEqual(many.get('u3').map((d) => d.messages), [5], 'who only has counted days has them');
    assert.ok((await streaks.busiestMembers(G, null)).includes('u3')); assert.ok((await streaks.recentMembers(G)).includes('u3'));
    // The batch really adds up, and the rules are read only for servers that filter and have a day to start from.
    counts.queueDay(G, 'u4', '2026-11-19'); counts.queueDay(G, 'u4', '2026-11-19'); await counts.flush();
    counts.queueDay(G, 'u4', '2026-11-19'); await counts.flush();
    assert.equal(Number((await pool.query("select messages from streak_days where guild_id = $1 and user_id = 'u4'", [G])).rows[0].messages), 3);
    await pool.query("update streak_config set min_length = 20 where guild_id = $1", [G]);
    assert.equal((await counts.loadFilters()).get(G).minLength, 20);
    await pool.query("update streak_config set counting_since = null where guild_id = $1", [G]);
    assert.equal((await counts.loadFilters()).has(G), false, 'no day to start from: not counted apart');
    await pool.query("delete from guilds where guild_id = $1", [G]);
    assert.equal(Number((await pool.query("select count(*) from streak_days where guild_id = $1", [G])).rows[0].count), 0, 'the days go with the server');
    await pool.end();
  }
  console.log('streak counting: ok');
})().catch((error) => { console.error(error); process.exit(1); });
