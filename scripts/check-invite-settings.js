// Checks the invite settings (quick leave, ignore bots, subtract leaves), the one function for the total, the options of `/invites config`, the
// dashboard route of the settings and what the tracker costs Discord (one fetch per join, none without Manage Server, a back-off after an error,
// a capped memory). The database, Discord and the log are replaced; scripts/check-invite-settings-db.js runs the SQL against a real database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const warnings = [];
stub('src/utils/logger.js', { info() {}, warn: (message) => warnings.push(String(message)), error() {}, debug() {} });
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });

const rules = require('../src/db/inviteTrackingRules');

// ---- the rules -------------------------------------------------------------------------------------------------------------------------
assert.deepEqual({ ...rules.DEFAULT_SETTINGS }, { fakeDays: 3, quickLeaveMinutes: 0, ignoreBots: false, subtractLeaves: true }, 'the defaults are today\'s behaviour');
const stats = { joins: 10, leaves: 4, bonus: 3, fake: 7 };
assert.equal(rules.inviteTotal(stats), 9, 'leaves are taken off by default (joins - leaves + bonus, as before)');
assert.equal(rules.inviteTotal(stats, true), 9);
assert.equal(rules.inviteTotal(stats, false), 13, 'with the setting off the leaves stay in');
assert.equal(rules.inviteTotal({}, true), 0);
assert.equal(rules.inviteTotal({ joins: '2', leaves: null, bonus: undefined }, false), 2);
assert.match(rules.inviteTotalSql({}, '$3'), /joins - case when \$3::boolean then leaves else 0 end \+ bonus/);

const joinedAt = Date.parse('2026-01-01T10:00:00Z');
const after = (minutes) => joinedAt + minutes * 60_000;
assert.equal(rules.isQuickLeave({ joinedAt, leftAt: after(3), quickLeaveMinutes: 0 }), false, '0 is off');
assert.equal(rules.isQuickLeave({ joinedAt, leftAt: after(3), quickLeaveMinutes: 5 }), true, 'inside the window');
assert.equal(rules.isQuickLeave({ joinedAt, leftAt: after(5), quickLeaveMinutes: 5 }), true, 'at the limit');
assert.equal(rules.isQuickLeave({ joinedAt, leftAt: after(6), quickLeaveMinutes: 5 }), false, 'outside the window');
assert.equal(rules.isQuickLeave({ joinedAt: null, quickLeaveMinutes: 5 }), false);

assert.deepEqual(rules.readSettingsPatch({ fakeDays: 7, quickLeaveMinutes: 1440, ignoreBots: true, subtractLeaves: false }), { values: { fakeDays: 7, quickLeaveMinutes: 1440, ignoreBots: true, subtractLeaves: false } });
assert.deepEqual(rules.readSettingsPatch({ fakeDays: 0 }), { values: { fakeDays: 0 } });
assert.deepEqual(rules.readSettingsPatch({}), { values: {} });
assert.deepEqual(rules.readSettingsPatch({ fakeDays: 366 }), { error: 'fakeDays' });
assert.deepEqual(rules.readSettingsPatch({ fakeDays: -1 }), { error: 'fakeDays' });
assert.deepEqual(rules.readSettingsPatch({ fakeDays: 1.5 }), { error: 'fakeDays' });
assert.deepEqual(rules.readSettingsPatch({ fakeDays: '' }), { error: 'fakeDays' });
assert.deepEqual(rules.readSettingsPatch({ quickLeaveMinutes: 1441 }), { error: 'quickLeaveMinutes' });
assert.deepEqual(rules.readSettingsPatch({ ignoreBots: 'yes' }), { error: 'ignoreBots' });
assert.deepEqual(rules.readSettingsPatch({ subtractLeaves: 1 }), { error: 'subtractLeaves' });

// Every place that adds up the invites goes through the one function: nothing writes the formula by hand any more.
for (const file of ['src/commands/info/invites.js', 'src/utils/inviteRewards.js', 'src/utils/inviteContext.js', 'src/web/inviteRoutes.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.ok(!/joins\s*-\s*\S*leaves/.test(code), `${file} does not write its own total`);
}

// ---- the settings and the leave in the database layer (the pool is replaced) ----------------------------------------------------------------
const queries = [];
let nextRows = [];
let failFirst = false;
stub('src/db/postgres.js', { getPrimaryPool: () => ({ query: async (sql, params) => {
  queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
  if (failFirst && /quick_leave_minutes/.test(sql) && /^select/i.test(String(sql).trim())) throw new Error('column does not exist');
  return { rows: nextRows, rowCount: nextRows.length };
} }), getPool: () => ({}) });
stub('src/db/database.js', { from: () => { throw new Error('not used'); }, rpc: async () => ({}) });
const tracking = require('../src/db/inviteTracking');

(async () => {
  nextRows = [];
  assert.deepEqual(await tracking.getSettings('g'), { fakeDays: 3, quickLeaveMinutes: 0, ignoreBots: false, subtractLeaves: true }, 'a server with no row');
  nextRows = [{ fake_days: 0, quick_leave_minutes: 15, ignore_bots: true, subtract_leaves: false }];
  assert.deepEqual(await tracking.getSettings('g'), { fakeDays: 0, quickLeaveMinutes: 15, ignoreBots: true, subtractLeaves: false });
  failFirst = true; nextRows = [{ fake_days: 9 }];
  assert.deepEqual(await tracking.getSettings('g'), { fakeDays: 9, quickLeaveMinutes: 0, ignoreBots: false, subtractLeaves: true }, 'a database without the new columns still gives the days');
  failFirst = false;

  queries.length = 0; nextRows = [];
  await tracking.setSettings('g', { quickLeaveMinutes: 20, ignoreBots: true });
  const save = queries.find((q) => /^insert into invite_config/.test(q.sql));
  assert.match(save.sql, /\(guild_id, quick_leave_minutes, ignore_bots\)/, 'only the settings given are written');
  assert.deepEqual(save.params, ['g', 20, true]);
  assert.doesNotMatch(save.sql, /fake_days/);
  queries.length = 0;
  await tracking.setSettings('g', {});
  assert.ok(!queries.some((q) => /^insert/.test(q.sql)), 'nothing given, nothing written');

  queries.length = 0; nextRows = [{ quick_leave_minutes: 12, fake_days: 3, ignore_bots: false, subtract_leaves: true }];
  const left = await tracking.recordLeave('g', 'u');
  const leave = queries.find((q) => /member_invites/.test(q.sql));
  assert.deepEqual(leave.params, ['g', 'u', 12], 'the window of the server is applied in the statement');
  assert.match(leave.sql, /left_at is null/, 'a leave that was already told finds nothing open');
  assert.equal(queries.filter((q) => /member_invites/.test(q.sql)).length, 1, 'one statement moves the row and the numbers');
  assert.ok(left, 'the row comes back');

  // ---- the command ---------------------------------------------------------------------------------------------------------------------
  const store = { ...rules.DEFAULT_SETTINGS };
  const saved = [];
  stub('src/db/inviteTracking.js', {
    getSettings: async () => ({ ...store }),
    setSettings: async (guildId, values) => { saved.push(values); Object.assign(store, values); return { ...store }; },
    setFakeDays: async (guildId, days) => { saved.push({ fakeDays: days }); },
    listRewards: async () => [{ invites: 5, role_id: '1' }],
  });
  stub('src/utils/inviteRewards.js', { applyRewards: async () => {} });
  const command = require('../src/commands/info/invites');
  const config = command.data.toJSON().options.find((option) => option.name === 'config');
  assert.deepEqual(config.options.map((o) => [o.name, o.type, o.required ?? false]), [['fake_days', 4, false], ['quick_leave_minutes', 4, false], ['ignore_bots', 5, false], ['subtract_leaves', 5, false]]);
  assert.deepEqual([config.options[0].min_value, config.options[0].max_value, config.options[1].min_value, config.options[1].max_value], [0, 365, 0, 1440]);
  for (const option of config.options) assert.ok(option.description.length <= 100);
  assert.equal(command.data.toJSON().options.filter((o) => o.type === 1).length, 8, 'no subcommand was added or removed');

  const replies = [];
  const perms = (...granted) => ({ has: (flag) => granted.includes(flag) });
  const run = async ({ values = {}, manage = true, lang = 'en' } = {}) => {
    replies.length = 0;
    const get = (name) => values[name] ?? null;
    await command.execute({
      pettoLang: lang, guild: { id: 'g', iconURL: () => null }, member: { permissions: perms(...(manage ? [PermissionFlagsBits.ManageGuild] : [])) },
      options: { getSubcommandGroup: () => null, getSubcommand: () => 'config', getInteger: get, getBoolean: get },
      reply: async (payload) => { replies.push(JSON.stringify(payload)); },
    });
    return replies[0];
  };
  let shown = await run({ manage: false });
  for (const text of ['Fake joins', 'Quick leave', 'Ignore bots', 'Subtract leaves', 'Rewards']) assert.ok(shown.includes(text), `the settings show ${text}`);
  assert.equal(saved.length, 0, 'showing the settings changes nothing, and anybody can look');
  shown = await run({ values: { quick_leave_minutes: 10 }, manage: false });
  assert.equal(saved.length, 0, 'Manage Server is needed to change a setting');
  assert.match(shown, /Manage Server/i);
  shown = await run({ values: { quick_leave_minutes: 10, ignore_bots: true, subtract_leaves: false } });
  assert.deepEqual(saved.at(-1), { quickLeaveMinutes: 10, ignoreBots: true, subtractLeaves: false }, 'several settings in one command');
  assert.ok(shown.includes('10') && shown.includes('minutes'));
  shown = await run({ values: { fake_days: 400 } });
  assert.equal(saved.length, 1, 'a value out of range is not saved');
  shown = await run({ manage: false });
  assert.ok(shown.includes('10 minutes'), 'the quick leave shows its minutes');
  assert.ok(await run({ lang: 'es', manage: false }));
  assert.ok((await run({ lang: 'pt-BR', manage: false })).includes('Saída rápida'));

  // ---- the dashboard route ------------------------------------------------------------------------------------------------------------
  const { registerInviteRoutes } = require('../src/web/inviteRoutes');
  const handlers = {};
  const authorized = [];
  const guild = { id: 'g', ownerId: 'o' };
  registerInviteRoutes({ post: (route, ...stack) => { handlers[route] = stack.at(-1); } }, {
    authorize: async (req, res, options) => {
      authorized.push(options);
      if (req.member?.denied) { res.status(403).json({ ok: false, code: 'forbidden' }); return null; }
      return { guild, member: req.member, userId: 'u' };
    },
    background: () => {},
  });
  const post = async (action, body, member = {}) => {
    let status = 200; let payload = null;
    const res = { status(code) { status = code; return this; }, json(value) { payload = value; return this; } };
    await handlers['/api/dashboard/guild/:guildId/invites/:action']({ params: { guildId: 'g', action }, body, member, query: {}, get: () => undefined, headers: {} }, res);
    return { status, ...payload };
  };
  saved.length = 0;
  let r = await post('settings', { fake_days: 7, quick_leave_minutes: 30, ignore_bots: true, subtract_leaves: false });
  assert.equal(r.ok, true); assert.deepEqual(saved.at(-1), { fakeDays: 7, quickLeaveMinutes: 30, ignoreBots: true, subtractLeaves: false });
  assert.deepEqual(authorized.at(-1), { page: 'stats', edit: true }, 'the same access as the other invite routes');
  assert.deepEqual(r.settings, { fakeDays: 7, quickLeaveMinutes: 30, ignoreBots: true, subtractLeaves: false });
  r = await post('settings', { quick_leave_minutes: 0 }); assert.equal(r.ok, true); assert.deepEqual(saved.at(-1), { quickLeaveMinutes: 0 }, 'what is not sent stays');
  const count = saved.length;
  r = await post('settings', { fake_days: 366 }); assert.equal(r.code, 'bad_days'); assert.equal(r.status, 400);
  r = await post('settings', { fake_days: -1 }); assert.equal(r.code, 'bad_days');
  r = await post('settings', { fake_days: '3.5' }); assert.equal(r.code, 'bad_days');
  r = await post('settings', { quick_leave_minutes: 1441 }); assert.equal(r.code, 'bad_minutes');
  r = await post('settings', { ignore_bots: 'true' }); assert.equal(r.code, 'bad_flag');
  r = await post('settings', {}); assert.equal(r.code, 'nothing');
  r = await post('settings', undefined); assert.equal(r.code, 'nothing');
  r = await post('settings', { fake_days: 5 }, { denied: true }); assert.equal(r.status, 403);
  assert.equal(saved.length, count, 'nothing wrong was saved');
  r = await post('fake_days', { days: 9 }); assert.equal(r.ok, true, 'the old route still works');

  // ---- what the tracker costs Discord --------------------------------------------------------------------------------------------------
  const inviteCache = require('../src/utils/inviteCache');
  const { resolveJoinInvite, wasVanityJoin, vanityUses, pending } = require('../src/utils/inviteResolve');
  const invite = (code, uses, inviterId = 'i1', maxUses = 0) => ({ code, uses, maxUses, inviter: { id: inviterId } });
  const collection = (...list) => new Map(list.map((i) => [i.code, i]));
  let guildCounter = 0;
  function makeGuild({ manage = true, invites = [], vanity = false } = {}) {
    const calls = { invites: 0, vanity: 0 };
    let result = collection(...invites);
    const g = {
      id: `guild${++guildCounter}`, calls, vanityURLCode: vanity ? 'x' : null, vanityUses: 0,
      members: { me: { permissions: { has: (flag) => manage && flag === 'ManageGuild' } } },
      invites: { fetch: async () => { calls.invites++; if (result instanceof Error) throw result; return result; } },
      fetchVanityData: async () => { calls.vanity++; return { code: 'x', uses: g.vanityUses }; },
      set(next) { result = next instanceof Error ? next : collection(...next); },
    };
    return g;
  }
  const join = (guildObj, id) => ({ id, guild: guildObj, user: { bot: false } });
  const httpError = (status, extra = {}) => Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    // One fetch per join, and the used invite is found by the uses that went up.
    let g = makeGuild({ invites: [invite('a', 1), invite('b', 4)] });
    await inviteCache.warmGuild(g);
    assert.equal(g.calls.invites, 1, 'one fetch to start');
    g.set([invite('a', 1), invite('b', 5)]);
    const m1 = join(g, 'm1');
    const [first, second] = await Promise.all([resolveJoinInvite(m1), resolveJoinInvite(m1)]);
    assert.equal(first.code, 'b'); assert.equal(second.code, 'b');
    assert.equal(g.calls.invites, 2, 'two listeners of the same join share one fetch');
    await resolveJoinInvite(m1);
    assert.equal(g.calls.invites, 2, 'a third caller of the same join does not fetch either');
    g.set([invite('a', 2), invite('b', 5)]);
    assert.equal((await resolveJoinInvite(join(g, 'm2'))).code, 'a');
    assert.equal(g.calls.invites, 3, 'the next join is one more fetch, nothing on a timer');

    // Invite events change the snapshot with no request; a created invite carries its limit, so a single-use one is found when it vanishes.
    g.set([invite('a', 2), invite('b', 5), invite('c', 0, 'i2', 1)]);
    inviteCache.setInvite(g.id, 'c', { uses: 0, inviterId: 'i2', maxUses: 1 });
    inviteCache.deleteInvite(g.id, 'b');
    assert.equal(g.calls.invites, 3, 'create and delete events do not fetch');
    assert.deepEqual([...inviteCache.getGuildCache(g.id).keys()].sort(), ['a', 'c']);
    g.set([invite('a', 2)]);
    const used = await resolveJoinInvite(join(g, 'm3'));
    assert.deepEqual([used.code, used.inviter.id], ['c', 'i2'], 'a single-use invite that is gone is the one that was used');

    // A server with no snapshot: an invite event holds nothing, and the first join is told as unknown instead of pointing at the first invite.
    const cold = makeGuild({ invites: [invite('x', 3), invite('y', 9)] });
    inviteCache.setInvite(cold.id, 'x', { uses: 3 });
    inviteCache.deleteInvite(cold.id, 'x');
    assert.equal(inviteCache.getGuildCache(cold.id), undefined, 'a server that never had a snapshot holds nothing for its invite events');
    assert.equal(await resolveJoinInvite(join(cold, 'c1')), null, 'nothing to compare with yet');
    assert.equal(cold.calls.invites, 1);
    cold.set([invite('x', 3), invite('y', 10)]);
    assert.equal((await resolveJoinInvite(join(cold, 'c2'))).code, 'y', 'the next join has the list from the first one');

    // Without Manage Server the endpoint is never called: not for a join, not at the start, not for the vanity link.
    const noPerm = makeGuild({ manage: false, invites: [invite('a', 1)], vanity: true });
    await inviteCache.warmGuild(noPerm);
    assert.equal(await resolveJoinInvite(join(noPerm, 'p1')), null);
    assert.equal(noPerm.calls.invites, 0, 'no Manage Server, no request');

    // After an error the server is left alone (one log line), then asked again when the time is up.
    for (const [label, error, seconds] of [['403', httpError(403), 600], ['5xx', httpError(502), 60], ['429', httpError(429, { retryAfter: 90_000 }), 90], ['network', new Error('socket hang up'), 60]]) {
      const bad = makeGuild({ invites: [invite('a', 1)] });
      await inviteCache.warmGuild(bad);
      warnings.length = 0;
      bad.set(error);
      assert.equal(await resolveJoinInvite(join(bad, 'e1')), null);
      assert.equal(bad.calls.invites, 2, `${label}: the failed fetch`);
      for (let i = 2; i < 8; i++) assert.equal(await resolveJoinInvite(join(bad, `e${i}`)), null);
      assert.equal(bad.calls.invites, 2, `${label}: six more joins did not ask again`);
      assert.equal(warnings.length, 1, `${label}: one log line`);
      assert.ok(warnings[0].length < 200 && warnings[0].includes(bad.id));
      assert.equal(inviteCache.getGuildCache(bad.id), undefined, `${label}: the snapshot that may be stale is dropped`);
      clock += seconds * 1000 + 1;
      bad.set([invite('a', 1)]);
      assert.equal(await resolveJoinInvite(join(bad, 'e9')), null, `${label}: after the back-off the first join only reads the list`);
      assert.equal(bad.calls.invites, 3, `${label}: asked again after the time`);
      bad.set([invite('a', 2)]);
      assert.equal((await resolveJoinInvite(join(bad, 'e10'))).code, 'a', `${label}: and it tracks again`);
    }
    // The vanity link follows the back-off too.
    const van = makeGuild({ invites: [invite('a', 1)], vanity: true });
    await inviteCache.warmGuild(van);
    van.set(httpError(403)); await resolveJoinInvite(join(van, 'v1'));
    assert.equal(await wasVanityJoin(van), false); assert.equal(van.calls.vanity, 0, 'no vanity request while backing off');

    // Memory is capped.
    const small = new Map();
    for (let i = 0; i < 12; i++) inviteCache.remember(small, `k${i}`, i, 10);
    assert.equal(small.size, 10); assert.ok(!small.has('k0') && small.has('k11'));
    for (let i = 0; i < inviteCache.MAX_GUILDS + 50; i++) inviteCache.replaceGuildCache(`cap${i}`, collection(invite('a', 0)));
    const held = [...Array(inviteCache.MAX_GUILDS + 50).keys()].filter((i) => inviteCache.getGuildCache(`cap${i}`)).length;
    assert.equal(held, inviteCache.MAX_GUILDS, 'the snapshots stop at the cap');
    for (let i = 0; i < inviteCache.MAX_GUILDS + 5; i++) inviteCache.remember(vanityUses, `v${i}`, 1);
    assert.ok(vanityUses.size <= inviteCache.MAX_GUILDS && pending.size <= 500);
  } finally {
    Date.now = realNow;
  }

  // ---- bots in the join handler --------------------------------------------------------------------------------------------------------
  const joins = [];
  const botSettings = { ...rules.DEFAULT_SETTINGS };
  stub('src/db/inviteTracking.js', { getSettings: async () => ({ ...botSettings }), recordJoin: async (...args) => { joins.push(args); return { fake: false }; } });
  stub('src/db/activityDetail.js', { queueFlow() {}, queueLifespan() {} });
  stub('src/db/statsRules.js', { allowed: () => true });
  stub('src/utils/inviteResolve.js', { resolveJoinInvite: async () => { throw new Error('a bot join must not read the invites'); }, wasVanityJoin: async () => false });
  const handler = require('../src/events/guildMemberAddInviteTracking');
  const bot = { id: 'b1', guild: { id: 'g', members: { me: { permissions: { has: () => true } } } }, user: { bot: true, createdTimestamp: Date.now() - 86_400_000 * 100 } };
  await handler.execute(bot);
  assert.equal(joins.length, 0, 'by default a bot join is not tracked, exactly as before');
  botSettings.ignoreBots = true;
  await handler.execute(bot);
  assert.equal(joins.length, 1);
  assert.deepEqual(joins[0].slice(0, 4), ['g', 'b1', null, null], 'recorded with nobody credited');
  assert.equal(joins[0][4].source, 'bot');

  console.log('Invite settings: defaults, quick leave, bots, the one total, /invites config, the dashboard route, one fetch per join, back-off and capped memory work.');
})().catch((err) => { console.error(err); process.exit(1); });
