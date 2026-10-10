// The invite tracker extras: which reward roles someone should have, the fake-join days and the periods.
const assert = require('node:assert/strict');
// Stubs let the database modules load without the configuration.
const path = require('node:path');
for (const file of ['../src/db/database.js', '../src/db/postgres.js']) { const full = path.resolve(__dirname, file); require.cache[full] = { id: full, filename: full, loaded: true, exports: { from: () => ({}), rpc: async () => ({}), getPrimaryPool: () => ({}) } }; }
const { planRewards } = require('../src/utils/inviteRewards');
const { isFakeJoin } = require('../src/db/inviteTrackingRules');

const rewards = [{ invites: 5, role_id: 'a' }, { invites: 10, role_id: 'b' }, { invites: 25, role_id: 'c' }];
assert.deepEqual(planRewards(rewards, 0), { give: [], take: ['a', 'b', 'c'] });
assert.deepEqual(planRewards(rewards, 5), { give: ['a'], take: ['b', 'c'] }, 'exactly the number is enough');
assert.deepEqual(planRewards(rewards, 12), { give: ['a', 'b'], take: ['c'] });
assert.deepEqual(planRewards(rewards, 99), { give: ['a', 'b', 'c'], take: [] });
assert.deepEqual(planRewards([], 4), { give: [], take: [] });

const young = Date.now() - 5 * 86_400_000;
assert.equal(isFakeJoin({ accountCreatedAt: young, previousRow: null, fakeDays: 3 }), false, 'a 5 day old account is fine with 3 days');
assert.equal(isFakeJoin({ accountCreatedAt: young, previousRow: null, fakeDays: 7 }), true, 'but fake with 7');
assert.equal(isFakeJoin({ accountCreatedAt: young, previousRow: null, fakeDays: 0 }), false, '0 turns the age check off');
assert.equal(isFakeJoin({ accountCreatedAt: young, previousRow: { user_id: '1' }, fakeDays: 0 }), true, 'somebody who came back is always fake');

const { periodStart } = require('../src/db/inviteTracking');
const wed = new Date('2026-10-07T15:00:00Z'); // Wednesday 10:00 in Colombia
assert.equal(periodStart('week', wed).toISOString(), '2026-10-05T05:00:00.000Z', 'the week starts on Monday at midnight in Colombia');
assert.equal(periodStart('month', wed).toISOString(), '2026-10-01T05:00:00.000Z');
assert.equal(periodStart('week', new Date('2026-10-05T04:00:00Z')).toISOString(), '2026-09-28T05:00:00.000Z', 'at 04:00 UTC on Monday it is still Sunday in Colombia');
console.log('Checked the invite rewards, the fake joins and the periods.');
