// The roles that payments give in the support server: the role of the Premium (1, 3 or 5 servers), the role of each plan, "Code" and "Priority Support".
// A role that is not set is never given; Premium and a plan together give each role once; ending what was paid takes the roles back; roles that are not
// managed (a staff role, a booster) are never touched. No Discord and no database: the rules are pure.
const assert = require('node:assert/strict');
const { desiredRoles, managedRoles, roleChanges, premiumRoleFor } = require('../src/utils/managedRoles');

const ids = {
  premium: { 1: 'p1', 3: 'p3', 5: 'p5' },
  plan: { bronze: 'bronze', silver: 'silver', gold: 'gold' },
  code: 'code',
  priority: 'priority',
};

// Premium of a server: its role by slots and Priority Support.
assert.equal(premiumRoleFor(ids, 0), null);
assert.equal(premiumRoleFor(ids, 1), 'p1');
assert.equal(premiumRoleFor(ids, 4), 'p3');
assert.equal(premiumRoleFor(ids, 5), 'p5');
assert.deepEqual(desiredRoles(ids, 3, null).sort(), ['p3', 'priority']);
// A plan: its role, Code and Priority Support.
assert.deepEqual(desiredRoles(ids, 0, 'silver').sort(), ['code', 'priority', 'silver']);
// Both: each role once.
assert.deepEqual(desiredRoles(ids, 1, 'gold').sort(), ['code', 'gold', 'p1', 'priority']);
// Nothing paid: nothing.
assert.deepEqual(desiredRoles(ids, 0, null), []);
// A role that is not set is left out, and with nothing set nothing is wanted.
assert.deepEqual(desiredRoles({ ...ids, priority: null }, 0, 'bronze').sort(), ['bronze', 'code']);
assert.deepEqual(desiredRoles({ premium: {}, plan: {}, code: null, priority: undefined }, 5, 'gold'), []);
assert.deepEqual(managedRoles({ premium: {}, plan: {}, code: null, priority: undefined }), []);
assert.equal(managedRoles(ids).length, 8);

// Changes: what is given, what is taken, and the roles of other kinds are never touched.
const mine = new Set(['staff', 'booster', 'bronze', 'code', 'priority']);
let change = roleChanges(ids, 0, 'gold', (id) => mine.has(id));
assert.deepEqual(change.add, ['gold']);
assert.deepEqual(change.remove, ['bronze']);
change = roleChanges(ids, 0, null, (id) => mine.has(id));
assert.deepEqual(change.add, []);
assert.deepEqual(change.remove.sort(), ['bronze', 'code', 'priority']);
assert.ok(!change.remove.includes('staff') && !change.remove.includes('booster'));
// Nothing to do when it is already right.
assert.deepEqual(roleChanges(ids, 0, 'bronze', (id) => mine.has(id)), { add: [], remove: [] });

console.log('Managed roles checks passed (Premium, plans, Code and Priority Support given once, taken back when it ends, other roles untouched).');
