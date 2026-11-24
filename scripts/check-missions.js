// Missions: the progress comes from the activity of the day and of the week, a finished mission pays once for each period, and the periods are right.
const assert = require('node:assert/strict');
const path = require('node:path');
const stub = (file, exports) => { const full = require.resolve(path.join('..', 'src', 'db', file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
let activity = { day: { messages: 0, voiceSeconds: 0 }, week: { messages: 0, voiceSeconds: 0 } };
const claims = new Set(); let balance = 10;
stub('missions', {
  activityBetween: async (_user, from, to) => (from === to ? activity.day : activity.week),
  claimed: async () => new Set(claims),
  claimOnce: async (_user, id, key, reward) => { const k = `${id}|${key}`; if (claims.has(k)) return { applied: false, balance: null }; claims.add(k); balance += reward; return { applied: true, balance }; },
});
stub('ceramos', { getWallet: async () => ({ balance, lastDaily: null }) });
const missions = require('../src/utils/missions');
const actions = require('../src/utils/missionActions');
(async () => {
  // Periods: a Wednesday, and a Monday.
  const wed = new Date('2026-11-25T15:30:00Z');
  assert.equal(missions.startOf('day', wed), '2026-11-25');
  assert.equal(missions.startOf('week', wed), '2026-11-23');
  assert.equal(missions.startOf('week', new Date('2026-11-23T00:00:00Z')), '2026-11-23');
  assert.equal(missions.startOf('week', new Date('2026-11-29T23:59:00Z')), '2026-11-23', 'Sunday is still that week');
  assert.equal(missions.endsAt('day', wed).toISOString(), '2026-11-26T00:00:00.000Z');
  assert.equal(missions.endsAt('week', wed).toISOString(), '2026-11-30T00:00:00.000Z');
  assert.equal(new Set(missions.MISSIONS.map((m) => m.id)).size, missions.MISSIONS.length, 'ids are unique');
  // Nothing done yet.
  let list = await actions.list('1', wed);
  assert.ok(list.missions.every((m) => !m.complete && !m.claimed && m.progress === 0));
  assert.deepEqual(await actions.claim('1', undefined, wed), { ok: false, error: 'nothing_to_claim' });
  // 30 messages today, 40 minutes in voice today, 120 messages and 4 hours in the week.
  activity = { day: { messages: 30, voiceSeconds: 40 * 60 }, week: { messages: 120, voiceSeconds: 240 * 60 } };
  list = await actions.list('1', wed);
  const by = Object.fromEntries(list.missions.map((m) => [m.id, m]));
  assert.equal(by['messages-day-25'].complete, true); assert.equal(by['messages-day-25'].progress, 25, 'progress is held at the target');
  assert.equal(by['messages-day-100'].complete, false); assert.equal(by['messages-day-100'].progress, 30);
  assert.equal(by['voice-day-30'].complete, true); assert.equal(by['voice-day-120'].progress, 40);
  assert.equal(by['messages-week-500'].progress, 120); assert.equal(by['voice-week-600'].progress, 240);
  // Claiming one that is not ready, one that does not exist, then everything that is ready.
  assert.deepEqual(await actions.claim('1', 'messages-day-100', wed), { ok: false, error: 'not_ready' });
  assert.deepEqual(await actions.claim('1', 'nope', wed), { ok: false, error: 'unknown_mission' });
  const paid = await actions.claim('1', undefined, wed);
  assert.equal(paid.ok, true); assert.equal(paid.total, 3 + 4); assert.equal(paid.paid.length, 2); assert.equal(paid.balance, 17);
  // It pays once for the period.
  assert.deepEqual(await actions.claim('1', undefined, wed), { ok: false, error: 'nothing_to_claim' });
  assert.equal((await actions.list('1', wed)).missions.find((m) => m.id === 'voice-day-30').claimed, true);
  // The next day the daily ones are open again; the weekly ones keep their state.
  const thu = new Date('2026-11-26T09:00:00Z');
  activity = { day: { messages: 100, voiceSeconds: 0 }, week: { messages: 220, voiceSeconds: 240 * 60 } };
  const next = await actions.claim('1', undefined, thu);
  assert.equal(next.ok, true); assert.deepEqual(next.paid.map((p) => p.id).sort(), ['messages-day-100', 'messages-day-25']);
  console.log('missions: ok');
})().catch((error) => { console.error(error); process.exit(1); });
