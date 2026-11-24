// Giving ceramos from the dashboard: who may, the limit of one gift and the limit of a day, the settings and what the page gets.
const assert = require('node:assert/strict');
const path = require('node:path');
const stub = (file, exports) => { const full = require.resolve(path.join('..', 'src', 'db', file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
let settings = { enabled: true, maxPerGrant: 100, maxPerDay: 150, people: ['222222222222222222'] };
let given = {}; const gifts = [];
stub('ceramosGrant', { getSettings: async () => ({ ...settings }), saveSettings: async (next) => { settings = next; }, givenToday: async (id) => given[id] ?? 0, recentGrants: async () => gifts });
stub('ceramos', { give: async (person, amount, reason, ref, by) => { given[by] = (given[by] ?? 0) + amount; gifts.push({ person, amount, reason, ref, by }); return 1000 + amount; } });
const actions = require('../src/utils/ceramosGrantActions');
const OWNER = '111111111111111111', TEAM = '222222222222222222', OTHER = '333333333333333333', PERSON = '444444444444444444';
(async () => {
  assert.deepEqual(await actions.grant(OTHER, OWNER, { person: PERSON, amount: 5 }), { ok: false, error: 'forbidden' });
  assert.equal((await actions.grant(TEAM, OWNER, { person: 'abc', amount: 5 })).error, 'bad_person');
  assert.equal((await actions.grant(TEAM, OWNER, { person: PERSON, amount: 0 })).error, 'bad_amount');
  assert.equal((await actions.grant(TEAM, OWNER, { person: PERSON, amount: 1.5 })).error, 'bad_amount');
  assert.deepEqual(await actions.grant(TEAM, OWNER, { person: PERSON, amount: 101 }), { ok: false, error: 'too_much', max: 100 });
  const ok = await actions.grant(TEAM, OWNER, { person: PERSON, amount: 100, note: '  contest prize  ' });
  assert.equal(ok.ok, true); assert.equal(ok.balance, 1100);
  assert.deepEqual(gifts.at(-1), { person: PERSON, amount: 100, reason: 'grant', ref: 'contest prize', by: TEAM });
  const limited = await actions.grant(TEAM, OWNER, { person: PERSON, amount: 60 });
  assert.deepEqual(limited, { ok: false, error: 'daily_limit', left: 50 });
  assert.equal((await actions.grant(TEAM, OWNER, { person: PERSON, amount: 50 })).ok, true);
  // The owner has no daily limit, only the limit of one gift.
  for (let i = 0; i < 3; i += 1) assert.equal((await actions.grant(OWNER, OWNER, { person: PERSON, amount: 100 })).ok, true);
  // With the switch off only the owner can give.
  settings.enabled = false;
  assert.equal((await actions.grant(TEAM, OWNER, { person: PERSON, amount: 1 })).error, 'forbidden');
  assert.equal((await actions.grant(OWNER, OWNER, { person: PERSON, amount: 1 })).ok, true);
  assert.equal((await actions.state(TEAM, OWNER)).allowed, false);
  settings.enabled = true;
  const teamState = await actions.state(TEAM, OWNER);
  assert.equal(teamState.allowed, true); assert.equal(teamState.leftToday, 0); assert.equal(teamState.settings, undefined);
  const ownerState = await actions.state(OWNER, OWNER);
  assert.equal(ownerState.isOwner, true); assert.equal(ownerState.leftToday, null); assert.deepEqual(ownerState.settings.people, [TEAM]);
  // The settings are checked.
  const saved = await actions.saveSettings({ enabled: false, maxPerGrant: 999999999, maxPerDay: -4, people: [TEAM, TEAM, 'x', 7, OTHER] });
  assert.deepEqual(saved.settings, { enabled: false, maxPerGrant: 100000, maxPerDay: 1, people: [TEAM, OTHER] });
  const kept = await actions.saveSettings({ people: 'nope', maxPerGrant: 'many' });
  assert.deepEqual(kept.settings, { enabled: false, maxPerGrant: 100000, maxPerDay: 1, people: [TEAM, OTHER] });
  console.log('ceramos grant: ok');
})().catch((error) => { console.error(error); process.exit(1); });
