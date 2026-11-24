// Streaks: what an active day is, the current and the best streak, freezes that cover missed days, and how the plan and the server settings feed it.
const assert = require('node:assert/strict');
const path = require('node:path');
const s = require('../src/utils/streaks');
const day = (n) => `2026-11-${String(n).padStart(2, '0')}`;
const days = (...ns) => ns.map(day);
// An active day: messages or minutes in voice, as the server asks.
const rows = [{ day: day(1), messages: 1, voiceSeconds: 0 }, { day: day(2), messages: 0, voiceSeconds: 1800 }, { day: day(3), messages: 5, voiceSeconds: 0 }, { day: day(4), messages: 0, voiceSeconds: 0 }];
assert.deepEqual(s.activeDays(rows, { minMessages: 1, minVoiceMinutes: 0 }), days(1, 3));
assert.deepEqual(s.activeDays(rows, { minMessages: 0, minVoiceMinutes: 30 }), days(2));
assert.deepEqual(s.activeDays(rows, { minMessages: 5, minVoiceMinutes: 10 }), days(2, 3));
assert.deepEqual(s.activeDays(rows, { minMessages: 0, minVoiceMinutes: 0 }), days(1, 2, 3), 'with no minimum, any activity counts');
// No activity.
assert.deepEqual(s.compute([], day(10), 0), { current: 0, best: 0, freezesUsed: 0, activeToday: false });
// Days in a row, today included.
assert.deepEqual(s.compute(days(5, 6, 7, 8), day(8), 0), { current: 4, best: 4, freezesUsed: 0, activeToday: true });
// Today not yet active: the streak is alive until the day ends.
assert.deepEqual(s.compute(days(5, 6, 7), day(8), 0), { current: 3, best: 3, freezesUsed: 0, activeToday: false });
// A missed day with no freeze breaks it.
assert.equal(s.compute(days(5, 6, 7), day(9), 0).current, 0);
assert.equal(s.compute(days(5, 6, 7), day(9), 0).best, 3);
// A freeze covers one missed day (inside the streak and while waiting).
assert.deepEqual(s.compute(days(5, 6, 8, 9), day(9), 1), { current: 4, best: 4, freezesUsed: 1, activeToday: true });
assert.equal(s.compute(days(5, 6, 8, 9), day(9), 0).current, 2, 'without the freeze the gap breaks it');
assert.equal(s.compute(days(5, 6, 7), day(9), 1).current, 3, 'one freeze keeps it alive for a day');
assert.equal(s.compute(days(5, 6, 7), day(10), 1).current, 0, 'two missed days with one freeze: it ended');
assert.equal(s.compute(days(5, 6, 7), day(10), 3).current, 3);
// The best streak can be an old one; two gaps need two freezes.
const old = s.compute(days(1, 2, 3, 4, 5, 6, 10, 11), day(11), 1);
assert.equal(old.best, 6); assert.equal(old.current, 2);
assert.equal(s.compute(days(1, 3, 5), day(5), 1).best, 2, 'one freeze covers only one of the two gaps');
assert.equal(s.compute(days(1, 3, 5), day(5), 2).best, 3);
// Repeated days count once.
assert.equal(s.compute([...days(5, 6), ...days(6)], day(6), 0).current, 2);

// The actions: the plan gives the freezes, a server can turn streaks off, and the rules of the server decide the days.
const stub = (file, exports) => { const full = require.resolve(path.join('..', 'src', 'db', file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
let config = { enabled: true, minMessages: 1, minVoiceMinutes: 0 }; let plan = null;
stub('streaks', { totalsOf: async () => ({ messages: 120, voiceSeconds: 7200 }), getConfig: async () => config, daysOf: async () => rows.concat([{ day: day(5), messages: 3, voiceSeconds: 0 }, { day: day(7), messages: 3, voiceSeconds: 0 }]), guildsOf: async () => ['100000000000000001', '100000000000000002'] });
stub('userPlans', { getPlan: async () => plan });
const actions = require('../src/utils/streakActions');
const now = new Date('2026-11-07T10:00:00Z');
(async () => {
  let r = await actions.inGuild('1', '100000000000000001', now);
  assert.equal(r.enabled, true); assert.equal(r.freezes, 0); assert.equal(r.current, 1, 'with no plan: days 5 and 7 are separated by the 6th');
  plan = { plan: 'gold', active: true };
  r = await actions.inGuild('1', '100000000000000001', now);
  assert.equal(r.freezes, 5); assert.equal(r.current, 4, 'the freezes cover the missed days: the active days 1, 3, 5 and 7 count'); assert.equal(r.freezesUsed, 3);
  plan = { plan: 'gold', active: false };
  assert.equal((await actions.inGuild('1', '100000000000000001', now)).freezes, 0, 'an ended plan gives no freezes');
  config = { enabled: false, minMessages: 1, minVoiceMinutes: 0 };
  assert.deepEqual(await actions.inGuild('1', '100000000000000001', now), { guildId: '100000000000000001', enabled: false });
  config = { enabled: true, minMessages: 1, minVoiceMinutes: 0 }; plan = { plan: 'silver', active: true };
  const all = await actions.mine('1', now);
  assert.equal(all.servers.length, 2); assert.equal(all.freezes, 3); assert.ok(all.bestEver >= all.longestNow);
  const sum = await actions.summary('1', now);
  assert.deepEqual(sum.totals, { messages: 120, voiceSeconds: 7200 }); assert.equal(sum.servers.length, 2);
  console.log('streaks: ok');
})().catch((error) => { console.error(error); process.exit(1); });
