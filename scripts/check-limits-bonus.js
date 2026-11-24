// The limits bonus of the plans: the reminders a person can have waiting are 25, and 31 (Bronze), 37 (Silver) or 50 (Gold); a plan that ended or cannot be read gives 25.
const assert = require('node:assert/strict');
const path = require('node:path');
const stub = (file, exports) => { const full = require.resolve(path.join('..', 'src', file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
const plan = {};
stub('db/userPlans.js', { getPlan: async (u) => { if (u === 'broken') throw new Error('database down'); return plan[u] ?? null; } });
const state = { active: 0, inserted: [] };
const query = { select() { return this; }, eq() { return this; }, insert(row) { state.inserted.push(row); return this; }, single() { return Promise.resolve({ data: { id: 1 }, error: null }); }, then(resolve) { resolve({ count: state.active, error: null }); } };
stub('db/database.js', { from: () => query });
const reminders = require('../src/db/reminders');
plan.b = { plan: 'bronze', active: true }; plan.s = { plan: 'silver', active: true }; plan.g = { plan: 'gold', active: true }; plan.old = { plan: 'gold', active: false };
(async () => {
  assert.equal(reminders.MAX_PER_USER, 25);
  const limits = {};
  for (const id of ['free', 'b', 's', 'g', 'old', 'broken']) limits[id] = await reminders.limitFor(id);
  assert.deepEqual(limits, { free: 25, b: 31, s: 37, g: 50, old: 25, broken: 25 });
  const make = (userId) => reminders.createReminder({ guildId: '1', channelId: '2', userId, message: 'x', remindAt: new Date() });
  state.active = 25;
  await assert.rejects(() => make('free'), (error) => error.userFacing === true && /25/.test(error.message), 'a free person stops at 25');
  assert.equal((await make('b')).id, 1, 'Bronze can have more than 25');
  state.active = 49; assert.equal((await make('g')).id, 1, 'Gold can have 49 and make one more');
  state.active = 50; await assert.rejects(() => make('g'), (error) => /50/.test(error.message), 'and stops at 50, telling them 50');
  console.log('limits bonus: ok');
})().catch((error) => { console.error(error); process.exit(1); });
