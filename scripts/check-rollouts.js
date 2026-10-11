// Rollout alerts: reading the list, telling what changed, the card and the pass that posts it.
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';

const api = require('../src/utils/rolloutApi');
const { diffRollouts, matchesEvent, snapshotOf } = require('../src/utils/rolloutDiff');
const { buildRolloutCard, rolloutContext, rolloutMessage, badge, variantLines } = require('../src/utils/rolloutMessages');
const { checkRollouts, canUseRollouts } = require('../src/utils/rolloutAlerts');
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
  assert.ok(json.includes('Users experiment (A/B)') && json.includes('Rollouts:') && json.includes('+12.5% (62.5%)') && json.includes('agnonotdev'), 'the card has the kind, the change and the credit');
  assert.equal(card.components[0].toJSON().components[0].accessory.disabled, true, 'the badge is a button that cannot be pressed');
  assert.ok(!JSON.stringify(buildRolloutCard(events[1], { hide_sections: ['status', 'variants', 'ranges'] }).components[0].toJSON()).includes('Status:'), 'a section can be hidden');
  assert.equal(buildRolloutCard(events[2], { accent_color: 0xff91c2 }).components[0].toJSON().accent_color, 0xff91c2, 'the color of a server');
  const ctx = rolloutContext(events[0]);
  assert.deepEqual([ctx.name, ctx.change, ctx.from, ctx.to, ctx.type], ['Android media viewer full resolution', '+12.5%', '50%', '62.5%', 'Rollout increased']);
  const message = await rolloutMessage({ id: 'g' }, { style: 'card', role_id: '99' }, events[0]);
  assert.deepEqual(message.allowedMentions, { parse: [], roles: ['99'] });

  // A pass.
  const sentTo = [];
  const client = { guilds: { cache: new Map([['g1', { id: 'g1', channels: { fetch: async () => ({ isTextBased: () => true, send: async (payload) => { sentTo.push(payload); return { id: 'm' }; } }) } }]]) } };
  let stored = new Map();
  const db = {
    loadState: async () => stored,
    saveState: async (entries) => { for (const [id, snapshot] of entries) stored.set(id, snapshot); },
    listEnabledConfigs: async () => [{ guild_id: 'g1', channel_id: 'c1', style: 'card', kinds: [], events: [], min_change: 0, include_unrolled: false, hide_sections: [] }],
  };
  let current = list;
  const fakeApi = { fetchRollouts: async () => ({ notModified: false, list: current }) };
  let result = await checkRollouts(client, { api: fakeApi, db, pause: 0 });
  assert.equal(result.baseline, true, 'the first pass only remembers');
  assert.equal(sentTo.length, 0);
  assert.equal(stored.size, 4);
  current = next;
  result = await checkRollouts(client, { api: fakeApi, db, pause: 0 });
  assert.equal(result.events, 3);
  assert.equal(result.sent, 3, 'every event is posted');
  result = await checkRollouts(client, { api: fakeApi, db, pause: 0 });
  assert.equal(result.events, 0, 'the same news is not told twice');
  result = await checkRollouts(client, { api: { fetchRollouts: async () => ({ notModified: true, list: next }) }, db, pause: 0 });
  assert.equal(result.skipped, true);

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
