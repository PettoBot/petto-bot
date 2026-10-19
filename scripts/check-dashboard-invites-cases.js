// Checks the dashboard routes of the Invites tab (src/web/inviteRoutes.js) and of the case log (src/web/caseRoutes.js): the same checks
// as `/invites` (roles Petto and the member can give, Manage Server, Administrator to reset) and `/case edit|delete` (Moderate Members),
// and the sanctions log written like the command. The database, Discord and the log are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {} });
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });

const rewards = new Map();
const stats = new Map();
let fakeDays = 3;
stub('src/db/inviteTracking.js', {
  setFakeDays: async (guildId, days) => { fakeDays = days; },
  listRewards: async () => [...rewards].map(([role_id, invites]) => ({ role_id, invites })),
  addReward: async (guildId, invites, roleId) => { rewards.set(roleId, invites); },
  removeReward: async (guildId, roleId) => rewards.delete(roleId),
  listInviterIds: async () => [...stats.keys()],
  resetUser: async (guildId, id) => { stats.set(id, { joins: 0, leaves: 0, bonus: 0 }); },
  addBonus: async (guildId, id, amount) => { const s = stats.get(id) ?? { joins: 0, leaves: 0, bonus: 0 }; s.bonus += amount; stats.set(id, s); return { ...s }; },
});
const applied = [];
stub('src/utils/inviteRewards.js', { applyRewards: async (guild, id) => { applied.push(id); } });

const cases = new Map([[7, { case_number: 7, user_id: '500000000000000001', type: 'warn', reason: 'spam' }], [8, { case_number: 8, user_id: '500000000000000002', type: 'ban', reason: null }]]);
const deleted = [];
stub('src/db/modActions.js', {
  getCase: async (guildId, number) => (cases.has(number) ? { ...cases.get(number) } : null),
  updateCase: async (guildId, number, { reason }) => { cases.set(number, { ...cases.get(number), reason }); return { ...cases.get(number) }; },
  deleteCase: async (guildId, number) => { deleted.push(number); return cases.delete(number); },
});

const { registerInviteRoutes } = require('../src/web/inviteRoutes');
const { registerCaseRoutes } = require('../src/web/caseRoutes');

const perms = (...granted) => ({ has: (flag) => granted.includes(flag) });
const role = (id, position, extra = {}) => ({ id, name: `role-${id}`, position, managed: false, ...extra });
const roles = new Map([
  ['300000000000000001', role('300000000000000001', 5)],
  ['300000000000000002', role('300000000000000002', 50)],
  ['300000000000000003', role('300000000000000003', 3, { managed: true })],
  ['300000000000000004', role('300000000000000004', 20)],
]);
const guild = { id: 'g', ownerId: 'owner', client: {}, members: { me: { roles: { highest: { position: 30 } } } }, roles: { cache: roles, fetch: async () => null } };
const admin = { id: 'admin', permissions: perms(PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ModerateMembers), roles: { highest: { position: 40 } } };
const manager = { id: 'manager', permissions: perms(PermissionFlagsBits.ManageGuild), roles: { highest: { position: 10 } } };

const handlers = {};
const app = { post: (route, ...stack) => { handlers[route] = stack.at(-1); } };
const pages = [];
const authorize = async (req, res, options) => { pages.push(options); return { guild, member: req.member, userId: req.member.id }; };
const everyone = [];
registerInviteRoutes(app, { authorize, background: (g) => everyone.push(g.id) });
const logged = [];
registerCaseRoutes(app, { authorize, staffLog: async (kind, client, g, data) => { logged.push({ kind, ...data }); } });

async function call(route, action, body, member = admin) {
  let status = 200; let payload = null;
  const res = { status(code) { status = code; return this; }, json(value) { payload = value; return this; }, set() { return this; } };
  await handlers[route]({ params: { guildId: 'g', action }, body, member, query: {}, get: () => undefined, headers: {} }, res);
  return { status, ...payload };
}
const invites = (action, body, member) => call('/api/dashboard/guild/:guildId/invites/:action', action, body, member);
const caseCall = (action, body, member) => call('/api/dashboard/guild/:guildId/cases/:action', action, body, member);

(async () => {
  let r = await invites('nope', {}); assert.equal(r.status, 404);
  r = await invites('reward', { role_id: '300000000000000001', invites: 5 });
  assert.equal(r.ok, true); assert.equal(rewards.get('300000000000000001'), 5); assert.deepEqual(everyone, ['g'], 'everyone already counted is checked after a new reward');
  assert.deepEqual(pages.at(-1), { page: 'stats', edit: true }, 'role access: an edit grant on Statistics');
  r = await invites('reward', { role_id: '300000000000000002', invites: 5 }); assert.equal(r.code, 'cannot_give', 'a role above Petto cannot be given');
  r = await invites('reward', { role_id: '300000000000000003', invites: 5 }); assert.equal(r.code, 'cannot_give', 'nor a role of an integration');
  r = await invites('reward', { role_id: 'g', invites: 5 }); assert.equal(r.code, 'bad_role');
  r = await invites('reward', { role_id: '300000000000000004', invites: 5 }, manager); assert.equal(r.code, 'above_yours', 'only roles below the member');
  r = await invites('reward', { role_id: '300000000000000001', invites: 0 }); assert.equal(r.code, 'bad_invites');
  r = await invites('unreward', { role_id: '300000000000000004' }); assert.equal(r.code, 'not_reward');
  r = await invites('unreward', { role_id: '300000000000000001' }); assert.equal(r.ok, true); assert.equal(rewards.size, 0);

  r = await invites('fake_days', { days: 400 }); assert.equal(r.code, 'bad_days');
  r = await invites('fake_days', { days: 7 }); assert.equal(r.ok, true); assert.equal(fakeDays, 7);
  r = await invites('fake_days', { days: 0 }); assert.equal(r.ok, true); assert.equal(fakeDays, 0);

  r = await invites('bonus', { member_id: '500000000000000009', amount: 0 }); assert.equal(r.code, 'bad_amount');
  r = await invites('bonus', { member_id: 'x', amount: 2 }); assert.equal(r.code, 'bad_member');
  r = await invites('bonus', { member_id: '500000000000000009', amount: 3 }, manager);
  assert.equal(r.ok, true); assert.match(r.message, /3/); assert.equal(stats.get('500000000000000009').bonus, 3); assert.ok(applied.includes('500000000000000009'), 'the reward roles follow the new number');
  r = await invites('reset', { member_id: '500000000000000009' }, manager); assert.equal(r.code, 'admin_only', 'a reset is for administrators, like the command');
  r = await invites('reset', { member_id: '500000000000000009' }); assert.equal(r.ok, true); assert.equal(stats.get('500000000000000009').bonus, 0);

  r = await caseCall('edit', { case: 7, reason: 'new' }, manager); assert.equal(r.code, 'no_permission', 'Moderate Members, like the command');
  assert.deepEqual(pages.at(-1), { page: 'moderation', edit: true }, 'role access: an edit grant on Moderation');
  r = await caseCall('edit', { case: 99, reason: 'x' }); assert.equal(r.code, 'not_found');
  r = await caseCall('edit', { case: 7, reason: '   ' }); assert.equal(r.code, 'empty_reason');
  r = await caseCall('edit', { case: 7, reason: 'Posted scam links' }); assert.equal(r.ok, true); assert.equal(cases.get(7).reason, 'Posted scam links');
  assert.deepEqual(logged.at(-1), { kind: 'caseEdited', moderator: 'admin', user: { id: '500000000000000001' }, number: 7, type: logged.at(-1).type });
  r = await caseCall('edit', { case: 7, reason: 'Posted scam links' }); assert.equal(r.ok, true); assert.equal(logged.length, 1, 'the same reason writes nothing');
  r = await caseCall('delete', { case: 'x' }); assert.equal(r.code, 'bad_case');
  r = await caseCall('delete', { case: 8 }); assert.equal(r.ok, true); assert.deepEqual(deleted, [8]); assert.equal(logged.at(-1).kind, 'caseDeleted');

  console.log('Dashboard invites and cases: reward roles with the checks of /invites, bonus, reset, fake joins, case reasons and deleting cases work.');
})().catch((err) => { console.error(err); process.exit(1); });
