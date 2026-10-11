// Rollout alerts: reading the list, telling what changed, the card and the pass that posts it.
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';

const api = require('../src/utils/rolloutApi');
const { diffRollouts, matchesEvent, snapshotOf } = require('../src/utils/rolloutDiff');
const { buildRolloutCard, rolloutContext, rolloutMessage, badge, variantLines } = require('../src/utils/rolloutMessages');
const { checkRollouts, drainQueue, canUseRollouts } = require('../src/utils/rolloutAlerts');
const config = require('../src/config');

const raw = [
  { id: '2026-10-android-media-viewer-full-resolution', title: 'Android media viewer full resolution', kind: 'apex_user', rollout_status: 'ab_test', platforms: ['android', 'desktop'], total: { from: 0, to: 50, change: 50 },
    variants: [{ variant: 0, role: 'control', to: 50, ranges: ['0 - 5000'] }, { variant: 1, role: 'treatment', to: 50, ranges: ['5000 - 10000'] }] },
  { id: '2026-10-badge-directory-updates', kind: 'user', rollout_status: null, variants: [{ variant: 0 }, { variant: 1 }] },
  { id: '2026-06_guild_rooms', title: 'Guild Rooms', kind: 'guild', rollout_status: 'rolling_out', total: { to: 0.01 },
    filters: [{ type: 'guild_member_count_range', args: { min_id: 3, max_id: 50 } }], variants: [{ variant: -1, role: 'not_eligible', to: 99.98, ranges: ['2 - 10000'] }, { variant: 5, role: 'treatment', to: 0.01, ranges: ['1 - 2'] }] },
  { id: 'hash:1443876045', rollout_status: null, variants: [{ variant: 1 }] },
  { id: 'bad id with spaces', variants: [] },
];

(async () => {
  // Reading the list.
  const list = raw.map(api.normalizeRollout).filter(Boolean);
  assert.equal(list.length, 4, 'an entry with an unusable id is left out');
  assert.equal(list[1].title, 'Badge directory updates', 'a missing name comes from the id');
  assert.equal(list[0].percent, 50);
  assert.equal(api.rangesPercent(['1600 - 3000', '4000 - 5000']), 24, 'ranges are out of 10000');
  assert.equal(list[2].filters[0], 'Servers of 3 to 50 members');
  assert.equal(list[3].kind, 'unknown');

  // What changed.
  const before = new Map(list.map((entry) => [entry.id, snapshotOf(entry)]));
  assert.deepEqual(diffRollouts(before, list), [], 'nothing changed, nothing to say');
  const next = list.map((entry) => ({ ...entry }));
  next[0] = { ...next[0], percent: 62.5, variants: next[0].variants.map((v) => (v.role === 'treatment' ? { ...v, percent: 62.5 } : v)) };
  next[2] = { ...next[2], percent: 0.005, status: 'full' };
  next.push(api.normalizeRollout({ id: '2026-11-new-thing', rollout_status: 'rolling_out', total: { to: 5 }, kind: 'user', variants: [{ variant: 1, role: 'treatment', to: 5, ranges: ['0 - 500'] }] }));
  const events = diffRollouts(before, next);
  assert.deepEqual(events.map((e) => e.type), ['increase', 'status', 'new']);
  assert.equal(events[0].change, 12.5);
  const down = diffRollouts(before, [{ ...list[0], percent: 40 }, ...list.slice(1)]);
  assert.equal(down[0].type, 'decrease');

  // Filters.
  assert.equal(matchesEvent(events[0], { kinds: [], events: [], min_change: 0 }), true);
  assert.equal(matchesEvent(events[0], { kinds: ['guild'], events: [] }), false, 'the kind filter');
  assert.equal(matchesEvent(events[0], { kinds: [], events: ['new'] }), false, 'the event filter');
  assert.equal(matchesEvent(events[0], { kinds: [], events: [], min_change: 20 }), false, 'small changes are ignored');
  const unrolled = diffRollouts(before, [...list, api.normalizeRollout({ id: '2026-11-no-rollout', kind: 'user', variants: [] })]);
  assert.equal(matchesEvent(unrolled[0], { kinds: [], events: [] }), false, 'a new experiment with no rollout waits');
  assert.equal(matchesEvent(unrolled[0], { kinds: [], events: [], include_unrolled: true }), true);

  // The card.
  assert.equal(badge(events[0]), '+12.5% (62.5%)');
  assert.deepEqual(variantLines(events[0]), ['Variant 0 (control): 50%', 'Variant 1: 50% → 62.5% (+12.5%)']);
  const card = buildRolloutCard(events[0], { role_id: '99', hide_sections: ['filters'] }, { rolePing: '<@&99>' });
  const json = JSON.stringify(card.components[0].toJSON());
  assert.ok(json.includes('Users experiment (A/B)') && json.includes('Rollouts') && json.includes('+12.5% (62.5%)') && json.includes('agnonotdev'), 'the card has the kind, the change and the credit');
  assert.ok(json.includes('pe_rexperiment') && !json.includes('pe_ban') && !json.includes('pe_mute') && !json.includes('pe_user_'), "Petto's own icons, never the ones of the sanctions");
  assert.equal(new URL(card.components[1].toJSON().components[0].url).hostname, 'gist.github.com', 'a link to the list');
  assert.ok(!JSON.stringify(buildRolloutCard(events[1], { hide_sections: ['status', 'variants', 'ranges'] }).components[0].toJSON()).includes('Status:'), 'a section can be hidden');
  assert.equal(buildRolloutCard(events[2], { accent_color: 0xff91c2 }).components[0].toJSON().accent_color, 0xff91c2, 'the color of a server');
  const ctx = rolloutContext(events[0]);
  assert.deepEqual([ctx.name, ctx.change, ctx.from, ctx.to, ctx.type], ['Android media viewer full resolution', '+12.5%', '50%', '62.5%', 'Rollout increased']);
  assert.ok(ctx.kind_icon.includes('pe_rexperiment') && ctx.event_icon.includes('pe_rup'), 'the icons are variables too');
  const message = await rolloutMessage({ id: 'g' }, { style: 'card', role_id: '99' }, events[0]);
  assert.deepEqual(message.allowedMentions, { parse: [], roles: ['99'] });

  // A pass, and the queue.
  const sentTo = [];
  const makeClient = (fail = false) => ({ guilds: { cache: new Map([['g1', { id: 'g1', channels: { fetch: async () => ({ isTextBased: () => true, send: async (payload) => { if (fail) throw new Error('Missing Access'); sentTo.push(payload); return { id: 'm' }; } }) } }]]) } });
  const client = makeClient();
  const stored = new Map();
  let queue = [];
  let nextId = 1;
  const db = {
    loadState: async () => stored,
    saveState: async (entries) => { for (const [id, snapshot] of entries) stored.set(id, snapshot); },
    listEnabledConfigs: async () => [{ guild_id: 'g1', channel_id: 'c1', style: 'card', kinds: [], events: [], min_change: 0, include_unrolled: false, hide_sections: [] }],
    countPending: async (guildId) => queue.filter((row) => row.guild_id === guildId).length,
    enqueue: async (rows) => { for (const row of rows) if (!queue.some((q) => q.guild_id === row.guild_id && q.event_key === row.event_key)) queue.push({ id: nextId++, attempts: 0, created_at: new Date(), ...row }); },
    pendingGuilds: async () => [...new Set(queue.map((row) => row.guild_id))],
    peek: async (guildId, limit) => queue.filter((row) => row.guild_id === guildId).slice(0, limit),
    removeQueued: async (ids) => { queue = queue.filter((row) => !ids.includes(row.id)); },
    markFailed: async (ids, attempts) => { for (const row of queue) if (ids.includes(row.id)) row.attempts = attempts; },
    clearGuildQueue: async (guildId) => { queue = queue.filter((row) => row.guild_id !== guildId); },
    dropOlderThan: async () => {},
  };
  let current = list;
  const fakeApi = { fetchRollouts: async () => ({ notModified: false, list: current }) };
  let result = await checkRollouts(client, { api: fakeApi, db });
  assert.equal(result.baseline, true, 'the first pass only remembers');
  assert.equal(queue.length, 0);
  assert.equal(stored.size, 4);
  current = next;
  result = await checkRollouts(client, { api: fakeApi, db });
  assert.equal(result.events, 3);
  assert.equal(result.queued, 3, 'the news waits in the queue');
  assert.equal(sentTo.length, 0, 'nothing is sent while reading');
  let turn = await drainQueue(client, { db });
  assert.deepEqual([turn.messages, turn.events, queue.length], [1, 1, 2], 'with only a few waiting a turn sends one card, the full one');
  await drainQueue(client, { db });
  await drainQueue(client, { db });
  assert.equal(queue.length, 0);
  assert.equal(sentTo.length, 3);
  result = await checkRollouts(client, { api: fakeApi, db });
  assert.equal(result.events, 0, 'the same news is not told twice');
  result = await checkRollouts(client, { api: { fetchRollouts: async () => ({ notModified: true, list: next }) }, db });
  assert.equal(result.skipped, true);

  // Fewer than the digest size go one at a time, each in its own card.
  const few = next.map((entry) => ({ ...entry }));
  few[0] = { ...few[0], percent: 70 };
  few[1] = { ...few[1], status: 'rolling_out', percent: 1 };
  current = few;
  await checkRollouts(client, { api: fakeApi, db });
  assert.equal(queue.length, 2);
  sentTo.length = 0;
  turn = await drainQueue(client, { db });
  assert.deepEqual([turn.messages, turn.events, queue.length], [1, 1, 1], 'one by one when there are only a couple');
  assert.ok(JSON.stringify(sentTo[0].components[0].toJSON()).includes('Rollouts'), 'a single one is the full card');

  // A big day: 200 changes are queued and go out ten at a time, one message per turn.
  const big = Array.from({ length: 200 }, (_, i) => api.normalizeRollout({ id: `2026-11-big-${i}`, rollout_status: 'rolling_out', kind: 'user', total: { to: 10 }, variants: [{ variant: 1, role: 'treatment', to: 10, ranges: ['0 - 1000'] }] }));
  queue = []; sentTo.length = 0;
  current = [...few, ...big];
  result = await checkRollouts(client, { api: fakeApi, db });
  assert.equal(result.queued, 200);
  let turns = 0;
  while (queue.length) { await drainQueue(client, { db }); turns += 1; assert.ok(turns < 50, 'the queue empties'); }
  assert.equal(turns, 20, 'two hundred changes are twenty messages');
  assert.equal(sentTo.length, 20);
  assert.ok(JSON.stringify(sentTo[0].components[0].toJSON()).includes('Rollout updates'), 'many at once are digest cards');

  // What Discord refuses is tried again, and given up after a few tries; a server that turned it off loses its queue.
  queue = []; sentTo.length = 0;
  await db.enqueue([{ guild_id: 'g1', event_key: 'a', event: events[2] }]);
  const refusing = makeClient(true);
  await drainQueue(refusing, { db });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].attempts, 1, 'a failed send is counted');
  for (let i = 0; i < 4; i += 1) await drainQueue(refusing, { db });
  assert.equal(queue.length, 0, 'after five tries it is dropped');
  await db.enqueue([{ guild_id: 'gone', event_key: 'b', event: events[2] }]);
  await drainQueue(client, { db });
  assert.equal(queue.length, 0, 'a server with the alerts off has nothing waiting');

  // Who can use it.
  config.rolloutsPublic = false;
  assert.equal(canUseRollouts('123456789012345678'), false);
  assert.equal(canUseRollouts(config.ownerId), true, 'the owner');
  config.rolloutTesterIds = ['123456789012345678'];
  assert.equal(canUseRollouts('123456789012345678'), true, 'a tester');
  config.rolloutsPublic = true;
  assert.equal(canUseRollouts('999999999999999999'), true, 'everyone once it is public');

  console.log('rollout checks passed');
})().catch((error) => { console.error(error); process.exit(1); });
