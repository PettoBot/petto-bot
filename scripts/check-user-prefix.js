// The prefix of your own: what a prefix may look like and who may have one.
const assert = require('node:assert/strict');
const { validateUserPrefix, accessReasons } = require('../src/utils/userPrefixRules');

for (const good of ['p!', ',', '.', '?', '>>', 'pt.', '!!']) assert.equal(validateUserPrefix(good).prefix, good, `${good} is fine`);
assert.equal(validateUserPrefix('  p! ').prefix, 'p!', 'spaces around it are cut');
for (const bad of ['', '   ', 'abcdef', 'p !', 'pt', 'x', '123', '/hi', '<@123>', '@', 'a@']) assert.ok(validateUserPrefix(bad).error, `${JSON.stringify(bad)} is refused`);

const cfg = { premiumRoleIds: { 1: 'p1', 3: 'p3' }, partnerRoleIds: ['partner'], userPrefixRoleIds: ['vip', 'friend'] };
assert.deepEqual(accessReasons({}, cfg), [], 'nobody by default');
assert.deepEqual(accessReasons({ team: true }, cfg), ['team']);
assert.deepEqual(accessReasons({ premium: true }, cfg), ['premium']);
assert.deepEqual(accessReasons({ member: { boosting: true, roleIds: [] } }, cfg), ['booster']);
assert.deepEqual(accessReasons({ member: { boosting: false, roleIds: ['partner'] } }, cfg), ['partner']);
assert.deepEqual(accessReasons({ member: { boosting: false, roleIds: ['friend'] } }, cfg), ['role']);
assert.deepEqual(accessReasons({ member: { boosting: false, roleIds: ['p3'] } }, cfg), ['premium'], 'a Premium role of the support server counts too');
assert.deepEqual(accessReasons({ team: true, member: { boosting: true, roleIds: ['vip', 'partner'] } }, cfg), ['team', 'booster', 'partner', 'role']);
assert.deepEqual(accessReasons({ member: { boosting: false, roleIds: ['other'] } }, cfg), [], 'a member of the server with no special role cannot');
assert.deepEqual(accessReasons({ member: { boosting: false, roleIds: ['vip'] } }, {}), [], 'with no roles configured, no role gives access');
console.log('Checked the rules of a prefix of your own.');
