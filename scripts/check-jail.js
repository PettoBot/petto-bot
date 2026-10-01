// Checks the role arithmetic behind jail without a database or Discord: what gets saved, what stays, what comes
// back on release, and that the guard only touches roles handed to a jailed member.
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const store = { config: { jail_role_id: 'jail' }, rows: [], saved: [] };
stub('src/db/jail.js', {
  getConfig: async () => store.config,
  listJailed: async () => store.rows,
  setSavedRoles: async (guildId, userId, ids) => store.saved.push([guildId, userId, ids]),
});
stub('src/db/modActions.js', {});
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const { removableRoles, jailedRoleIds, releasedRoleIds } = require('../src/utils/jail');
const { enforceJail, invalidateJailCache } = require('../src/utils/jailGuard');

function role(id, extra = {}) {
  return { id, managed: false, editable: true, ...extra };
}

function makeMember(guildRoles, heldIds) {
  const cache = new Map(heldIds.map((id) => [id, guildRoles.get(id)]));
  cache.filter = (fn) => {
    const out = new Map([...cache].filter(([, value]) => fn(value)));
    out.map = (fn2) => [...out.values()].map(fn2);
    out.keys = () => [...out].map(([key]) => key)[Symbol.iterator]();
    out.filter = cache.filter;
    return out;
  };
  return { id: 'member', guild: { id: 'guild', roles: { cache: guildRoles } }, roles: { cache } };
}

const roles = new Map([
  ['guild', role('guild', { editable: false })],
  ['jail', role('jail')],
  ['member', role('member')],
  ['vip', role('vip')],
  ['booster', role('booster', { managed: true })],
  ['admin', role('admin', { editable: false })],
  ['gone', role('gone')],
]);
roles.get = Map.prototype.get.bind(roles);

const member = makeMember(roles, ['guild', 'member', 'vip', 'booster', 'admin']);
const jail = roles.get('jail');

// Saved: everything Petto may take away. Kept: roles it cannot remove, plus the jail role.
assert.deepEqual([...removableRoles(member, jail).keys()].sort(), ['member', 'vip']);
assert.deepEqual(jailedRoleIds(member, jail).sort(), ['admin', 'booster', 'jail']);

// Released: what they hold now (minus the jail role) plus what was saved, skipping roles that no longer exist or can no longer be given.
const jailed = makeMember(roles, ['guild', 'jail', 'booster', 'admin']);
assert.deepEqual(releasedRoleIds(jailed, jail, ['member', 'vip']).sort(), ['admin', 'booster', 'member', 'vip']);
assert.deepEqual(releasedRoleIds(jailed, jail, ['member', 'deleted-role']).sort(), ['admin', 'booster', 'member'], 'a deleted role is skipped');
roles.get('vip').editable = false;
assert.deepEqual(releasedRoleIds(jailed, jail, ['member', 'vip']).sort(), ['admin', 'booster', 'member'], 'a role above the bot is skipped');
roles.get('vip').editable = true;
assert.deepEqual(releasedRoleIds(jailed, jail, ['member', 'member']).sort(), ['admin', 'booster', 'member'], 'no duplicates');

// Guard.
(async () => {
  store.rows = [{ user_id: 'member', saved_role_ids: ['member'] }];
  invalidateJailCache('guild');
  const removeCalls = [];
  const wrap = (heldIds) => {
    const m = makeMember(roles, heldIds);
    m.user = { bot: false };
    m.roles.remove = async (ids) => removeCalls.push(ids);
    return m;
  };

  const before = wrap(['guild', 'jail']);
  const after = wrap(['guild', 'jail', 'vip', 'booster']);
  assert.equal(await enforceJail(before, after), 1, 'a role handed to a jailed member is taken off (managed roles are left alone)');
  assert.deepEqual(removeCalls.at(-1), ['vip']);
  assert.deepEqual(store.saved.at(-1), ['guild', 'member', ['member', 'vip']], 'it is saved for release');

  const callsBefore = removeCalls.length;
  assert.equal(await enforceJail(wrap(['guild']), wrap(['guild', 'jail'])), 0, 'receiving the jail role is not touched');
  store.rows = [];
  invalidateJailCache('guild');
  assert.equal(await enforceJail(wrap(['guild']), wrap(['guild', 'vip'])), 0, 'someone who is not jailed is not touched');
  assert.equal(removeCalls.length, callsBefore);

  console.log('Checked the jail role rules and the jail guard.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
