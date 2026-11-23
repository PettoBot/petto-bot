// The plans of a person: what each one gives (the numbers the website shows), giving one from the dashboard (the plan, for how many days, a note, who), a plan that is past
// its end not counting, and the daily ceramos and the places of the showcase following the plan. No database and no Discord: they are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');

const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
const table = new Map();
stub('src/db/userPlans.js', {
  getPlan: async (id) => { const row = table.get(id); return row ? { ...row, active: !row.endsAt || new Date(row.endsAt) > new Date() } : null; },
  setPlan: async (id, plan, endsAt, source, by, note) => { table.set(id, { userId: id, plan, endsAt, renews: false, source, grantedBy: by, note }); },
  endPlan: async (id) => { const row = table.get(id); if (!row || (row.endsAt && new Date(row.endsAt) <= new Date())) return false; row.endsAt = new Date().toISOString(); return true; },
  listActive: async () => [...table.values()],
});
// The profile view loads canvas pictures and the database; here only the plan lookup matters.
const plansDb = require('../src/db/userPlans');
const badges = require('../src/utils/profileBadges');
const userPlans = require('../src/utils/userPlans');
const ceramos = require('../src/utils/ceramos');
const admin = require('../src/utils/planAdmin');

(async () => {
  // The numbers: every plan gives more than the one before, and they are the ones the website promises.
  const order = ['free', 'bronze', 'silver', 'gold'];
  for (const key of ['aiPerDay', 'showcaseSlots', 'ownBadges', 'ceramosPerDay', 'streakFreezes', 'limitsBonus']) {
    for (let i = 1; i < order.length; i += 1) assert.ok(userPlans.PLAN_PERKS[order[i]][key] >= userPlans.PLAN_PERKS[order[i - 1]][key], `${key} grows with the plan`);
  }
  assert.deepEqual(['bronze', 'silver', 'gold'].map((key) => userPlans.PLAN_PERKS[key].price), [3.99, 5.99, 9.99]);
  assert.deepEqual(['bronze', 'silver', 'gold'].map((key) => userPlans.PLAN_PERKS[key].aiPerDay), [20, 60, 150]);
  assert.deepEqual(['bronze', 'silver', 'gold'].map((key) => userPlans.PLAN_PERKS[key].ceramosPerDay), [5, 10, 20]);
  assert.equal(userPlans.PLAN_PERKS.free.ceramosPerDay, 2);
  for (const key of ['bronze', 'silver', 'gold']) {
    assert.equal(userPlans.PLAN_PERKS[key].showcaseSlots, badges.slotsFor(key), `${key}: the showcase has the places the plan says`);
    assert.equal(userPlans.PLAN_PERKS[key].ceramosPerDay, ceramos.dailyAmount(key), `${key}: /daily gives what the plan says`);
  }
  assert.equal(userPlans.PLAN_PERKS.free.showcaseSlots, badges.slotsFor(null));
  assert.equal(userPlans.PLAN_PERKS.free.ceramosPerDay, ceramos.dailyAmount(null));

  // What the team sends to give a plan.
  const now = new Date('2026-12-01T00:00:00Z');
  assert.equal(userPlans.checkGrant({ plan: 'gold', days: 30 }, now).endsAt, '2026-12-31T00:00:00.000Z');
  assert.equal(userPlans.checkGrant({ plan: 'silver' }, now).endsAt, null, 'no days: no end');
  assert.equal(userPlans.checkGrant({ plan: 'diamond', days: 30 }, now).error, 'bad_plan');
  assert.equal(userPlans.checkGrant({ plan: 'gold', days: 0 }, now).error, 'bad_days');
  assert.equal(userPlans.checkGrant({ plan: 'gold', days: 99999 }, now).error, 'bad_days');
  assert.equal(userPlans.checkGrant({ plan: 'gold', days: 1.5 }, now).error, 'bad_days');
  assert.equal(userPlans.checkGrant({ plan: 'gold', days: 5, note: 'x'.repeat(500) }, now).note.length, 200);

  // Giving and ending a plan.
  assert.equal((await admin.grant('1', { person: 'abc', plan: 'gold' })).error, 'bad_person');
  assert.equal((await admin.grant('1', { person: '293504726505357312', plan: 'nope' })).error, 'bad_plan');
  const given = await admin.grant('1', { person: '293504726505357312', plan: 'gold', days: 30, note: 'friend' });
  assert.equal(given.ok, true);
  assert.equal(table.get('293504726505357312').grantedBy, '1');
  assert.equal(table.get('293504726505357312').source, 'team');
  assert.equal((await plansDb.getPlan('293504726505357312')).active, true);
  assert.equal((await admin.list()).plans.length, 1);
  assert.equal((await admin.end({ person: '293504726505357312' })).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await plansDb.getPlan('293504726505357312')).active, false, 'an ended plan is not active');
  assert.equal((await admin.end({ person: '293504726505357312' })).error, 'not_found', 'ending it twice says so');
  assert.equal((await admin.end({ person: '999999999999999999' })).error, 'not_found');
  console.log('User plan checks passed.');
})().catch((error) => { console.error(error); process.exit(1); });
