// Checks the aged roles ("after N days in the server, give this role and take another away"): who is due (pure), the rules in a real PostgreSQL database
// (PETTO_TEST_DATABASE_URL; skipped without it), and one look at a fake server (roles given and taken, the limits of Petto, the cap of changes in one look).
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.PETTO_AGED_ROLES_GAP_MS = '0';
process.env.DISCLOUD_DATABASE_URL ||= process.env.PETTO_TEST_DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const aged = require('../src/utils/agedRoles');

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 18);
const rule = (patch) => ({ id: 1, roleId: 'VET', days: 7, removeRoleId: null, target: 'humans', enabled: true, ...patch });
const member = (daysAgo, roles = [], bot = false) => ({ bot, joinedTimestamp: NOW - daysAgo * DAY, roleIds: new Set(roles) });

// ---- Who is due (no database) ----
{
  const due = (m, rules) => aged.dueChanges(m, rules, NOW);
  assert.deepEqual(due(member(6.9), [rule()]).add, [], 'not yet');
  assert.deepEqual(due(member(7), [rule()]).add.map((a) => a.roleId), ['VET'], 'on the day');
  assert.deepEqual(due(member(30, ['VET']), [rule()]).add, [], 'a member who has it already gets nothing');
  assert.deepEqual(due(member(30), [rule({ enabled: false })]).add, [], 'a rule that is off does nothing');
  assert.deepEqual(due(member(30, [], true), [rule()]).add, [], 'humans only: not a bot');
  assert.deepEqual(due(member(30, [], true), [rule({ target: 'all' })]).add.map((a) => a.roleId), ['VET'], 'everyone: a bot too');
  assert.deepEqual(due(member(30, []), [rule({ target: 'bots' })]).add, [], 'bots only: not a person');
  const both = due(member(10, ['NEW']), [rule({ removeRoleId: 'NEW' })]);
  assert.deepEqual([both.add.map((a) => a.roleId), both.remove.map((r) => r.roleId)], [['VET'], ['NEW']], 'the role is given and the other taken away');
  assert.deepEqual(due(member(10, ['VET']), [rule({ removeRoleId: 'NEW' })]).remove, [], 'nothing to take if they do not have it');
  const stages = due(member(40, []), [rule({ id: 1, roleId: 'A', days: 7 }), rule({ id: 2, roleId: 'B', days: 30 }), rule({ id: 3, roleId: 'C', days: 90 })]);
  assert.deepEqual(stages.add.map((a) => a.roleId), ['A', 'B'], 'several stages: only the ones reached');
  assert.deepEqual(aged.dueChanges({ bot: false, joinedTimestamp: null, roleIds: new Set() }, [rule()], NOW).add, [], 'a member whose join date is not known is left alone');
}

// ---- One look at a fake server ----
const fakeGuild = (rules, members, { editable = () => true } = {}) => {
  const calls = { added: [], removed: [] };
  const roles = new Map(['VET', 'NEW', 'HIGH'].map((id) => [id, { id, managed: id === 'MANAGED', position: id === 'HIGH' ? 50 : 1 }]));
  const guild = {
    id: 'G', memberCount: members.length, roles: { cache: roles }, members: {
      me: { roles: { highest: { position: 10 } } },
      cache: new Map(), fetch: async () => new Map(members.map((m) => [m.id, m])),
    },
  };
  for (const m of members) {
    m.user = { bot: m.bot };
    m.roles = { cache: new Map(m.roleIds.map((id) => [id, {}])), add: async (id) => { calls.added.push([m.id, id]); }, remove: async (id) => { calls.removed.push([m.id, id]); } };
    m.joinedTimestamp = m.joinedAt;
  }
  return { guild, calls };
};

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Checked who is due for an aged role (skipped the database part: set PETTO_TEST_DATABASE_URL).');
  process.exit(0);
}
const { getPrimaryPool, closePools } = require('../src/db/postgres');
const G = 'G';
const GID = '9400000000000000001';

(async () => {
  const pool = getPrimaryPool();
  await pool.query('delete from guilds where guild_id = $1', [G]);
  await pool.query('insert into guilds (guild_id) values ($1)', [G]);

  // Rules
  assert.deepEqual(await aged.addRule(G, { roleId: 'VET', days: 7, removeRoleId: 'NEW' }), { ok: true });
  assert.deepEqual(await aged.addRule(G, { roleId: 'VET', days: 0 }), { ok: false, reason: 'days' });
  assert.deepEqual(await aged.addRule(G, { roleId: 'VET', days: 4000 }), { ok: false, reason: 'days' });
  assert.deepEqual(await aged.addRule(G, { roleId: 'VET', days: 5, removeRoleId: 'VET' }), { ok: false, reason: 'same' });
  assert.deepEqual(await aged.addRule(G, { roleId: 'VET', days: 7, removeRoleId: null, target: 'all' }), { ok: true }, 'the same role and days is updated, not repeated');
  let list = await aged.rulesOf(G);
  assert.equal(list.length, 1); assert.equal(list[0].target, 'all'); assert.equal(list[0].removeRoleId, null);
  await aged.addRule(G, { roleId: 'VET', days: 7, removeRoleId: 'NEW', target: 'humans' });
  await pool.query("insert into aged_roles (guild_id, role_id, days, target) values ($1, 'X', 3, 'robots')", [G]).then(() => assert.fail('a bad target'), (err) => assert.match(String(err.message), /check/));
  for (let i = 0; i < aged.MAX_RULES - 1; i += 1) assert.equal((await aged.addRule(G, { roleId: `R${i}`, days: 10 })).ok, true);
  assert.deepEqual(await aged.addRule(G, { roleId: 'ONE_TOO_MANY', days: 10 }), { ok: false, reason: 'full' }, 'the limit of rules');
  assert.equal(await aged.removeRule(G, 'R0'), 1);
  for (let i = 1; i < aged.MAX_RULES - 1; i += 1) await aged.removeRule(G, `R${i}`);
  list = await aged.rulesOf(G);
  assert.equal(list.length, 1);

  // One look: a member who is old enough gets the role and loses the other, a young one is left alone, a role above Petto is not touched.
  const old = { id: 'old', bot: false, roleIds: ['NEW'], joinedAt: Date.now() - 10 * DAY };
  const young = { id: 'young', bot: false, roleIds: ['NEW'], joinedAt: Date.now() - 1 * DAY };
  const bot = { id: 'bot', bot: true, roleIds: [], joinedAt: Date.now() - 10 * DAY };
  const { guild, calls } = fakeGuild(list, [old, young, bot]);
  const changes = await aged.runGuild(guild);
  assert.deepEqual(calls.added, [['old', 'VET']]);
  assert.deepEqual(calls.removed, [['old', 'NEW']]);
  assert.equal(changes, 2);

  // A role Petto cannot give (above its own role) is left alone.
  await aged.removeRule(G, 'VET');
  await aged.addRule(G, { roleId: 'HIGH', days: 1 });
  const again = fakeGuild(await aged.rulesOf(G), [{ id: 'old2', bot: false, roleIds: [], joinedAt: Date.now() - 10 * DAY }]);
  assert.equal(await aged.runGuild(again.guild), 0);
  assert.deepEqual(again.calls.added, []);

  // A big backlog is cut: at most 200 changes in one look.
  await aged.removeRule(G, 'HIGH');
  await aged.addRule(G, { roleId: 'VET', days: 1 });
  const crowd = Array.from({ length: 260 }, (_, i) => ({ id: `m${i}`, bot: false, roleIds: [], joinedAt: Date.now() - 5 * DAY }));
  const big = fakeGuild(await aged.rulesOf(G), crowd);
  const started = Date.now();
  const done = await Promise.race([aged.runGuild(big.guild), new Promise((resolve) => setTimeout(() => resolve('slow'), 120_000))]);
  assert.equal(done, 200, 'a look stops at 200 changes');
  assert.ok(Date.now() - started < 120_000);

  // They go with the server.
  await pool.query('delete from guilds where guild_id = $1', [G]);
  assert.equal(Number((await pool.query('select count(*)::int as n from aged_roles where guild_id = $1', [G])).rows[0].n), 0);
  await closePools();
  void GID;
  console.log('Checked the aged roles: who is due, the rules and their limits, one look at a server, the cap of changes, and that they go with the server.');
})().catch((err) => { console.error(err); process.exit(1); });
