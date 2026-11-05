// Checks the role triggers (src/utils/roleTriggers.js): which rules a member update fires (a role given, the onboarding finished, both), who is never touched
// (bots, Petto, the owner, staff, mod levels, members at or above Petto), that a grant is handled once, the circuit breaker, the validation of a rule, and the event
// path with Discord and the database replaced (no query when nothing happened, the case written with Petto as the moderator, the reason of the case).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');
const { GuildMemberFlags, GuildMemberFlagsBitField, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// ---- Replaced: the database, the sanction helpers, the log -------------------------------------------------------------------
const state = { rules: [], listCalls: 0, cases: [], warns: [], logs: [], dms: [], sendLogs: [], level: 0, jailError: null, jails: [] };
stub('src/db/roleTriggers.js', { listRules: async () => { state.listCalls += 1; return state.rules; }, upsertRule: async () => ({}), removeRule: async () => true, getLimit: async () => state.limit ?? null, setLimit: async (guildId, value) => { state.limit = value; }, clearLimit: async () => { state.limit = null; }, guildIdsWithRules: async () => [] });
stub('src/db/modActions.js', { createCase: async (row) => { const modCase = { ...row, case_number: state.cases.length + 1 }; state.cases.push(modCase); return modCase; } });
stub('src/db/warns.js', { addWarn: async (row) => { state.warns.push(row); const modCase = { ...row, type: 'warn', case_number: 90 + state.warns.length }; return { modCase, warnCount: state.warns.length }; } });
stub('src/db/guilds.js', { ensureGuild: async () => ({ mute_role_id: null }), getGuild: async () => ({}), setGuildLookup() {}, peekGuild: () => null });
stub('src/db/permissions.js', { getEffectiveLevel: async () => state.level });
stub('src/utils/caseLog.js', { logSanction: async (client, guild, entry) => { state.logs.push(entry); } });
stub('src/utils/sanctionTemplates.js', { sanctionDM: async (entry) => ({ content: `dm ${entry.type}`, entry }), sanctionReply: async () => {}, actionText: () => '', sourceText: (s) => s, sanctionContext: () => ({}), sanctionLogEmbed: async () => null });
stub('src/utils/escalation.js', { checkAndApplyEscalation: async () => {} });
stub('src/utils/muteRole.js', { ensureMuteRole: async () => ({ id: 'mute-role' }) });
stub('src/utils/jail.js', {
  JailError: class JailError extends Error {},
  jailMember: async ({ member, durationMs }) => {
    if (state.jailError) throw new (require('../src/utils/jail').JailError)(state.jailError);
    state.jails.push({ member, durationMs });
    return { modCase: { type: 'jail', case_number: 50 } };
  },
});
stub('src/utils/dmOrigin.js', { sendDm: async (target, payload) => { state.dms.push(payload.entry.type); } });
stub('src/logging/engine.js', { sendLog: async (client, guildId, event, embed) => { state.sendLogs.push({ guildId, event, embed }); } });

const lib = require('../src/utils/roleTriggers');
const { matchRules, safetySkip, createDoneMemory, createBreaker, validateRule, onboardingJustCompleted, addedRoles } = lib;

const flags = (...list) => new GuildMemberFlagsBitField(list.reduce((sum, flag) => sum | flag, 0));
const set = (...ids) => new Set(ids);
const rule = (role_id, action = 'ban', on_event = 'role_added', extra = {}) => ({ role_id, action, on_event, duration_ms: null, reason: null, ...extra });

(async () => {
  // ---- Matching -----------------------------------------------------------------------------------------------------------------
  const rules = [rule('A', 'ban', 'role_added'), rule('B', 'kick', 'onboarding'), rule('C', 'warn', 'either')];
  const ids = (list) => list.map((r) => r.role_id).join('');
  assert.equal(ids(matchRules(rules, { addedRoleIds: set('A', 'B', 'C'), heldRoleIds: set('A', 'B', 'C'), onboardingCompleted: false })), 'AC', 'a role given fires role_added and either, not onboarding');
  assert.equal(ids(matchRules(rules, { addedRoleIds: set(), heldRoleIds: set('A', 'B', 'C'), onboardingCompleted: true })), 'BC', 'onboarding finished fires the ones that hold the role: onboarding and either, not role_added');
  assert.equal(ids(matchRules(rules, { addedRoleIds: set(), heldRoleIds: set('A'), onboardingCompleted: true })), '', 'onboarding with none of the roles fires nothing');
  assert.equal(ids(matchRules(rules, { addedRoleIds: set('B'), heldRoleIds: set('B'), onboardingCompleted: true })), 'B', 'a rule matches once even when both happen');
  assert.equal(ids(matchRules(rules, { addedRoleIds: set(), heldRoleIds: set('A', 'B', 'C'), onboardingCompleted: false })), '', 'holding a role fires nothing by itself');

  // ---- What changed in a member -------------------------------------------------------------------------------------------------
  const member = (roles, flagList = [], extra = {}) => ({
    id: extra.id ?? 'u1', partial: false, user: { bot: false, id: extra.id ?? 'u1' }, flags: flags(...flagList),
    roles: { cache: new Map(roles.map((id) => [id, {}])), highest: { position: extra.top ?? 1 } },
    permissions: new PermissionsBitField(extra.perms ?? 0n), guild: extra.guild ?? { id: 'g1', ownerId: 'owner' }, ...extra.rest,
  });
  assert.deepEqual([...addedRoles(member(['g1']), member(['g1', 'A', 'B']))].sort(), ['A', 'B']);
  assert.equal(addedRoles(member(['g1', 'A']), member(['g1', 'A'])).size, 0);
  assert.equal(addedRoles({ partial: true }, member(['g1', 'A'])).size, 0, 'without the old copy nothing is known');
  assert.equal(addedRoles(member(['g1']), member(['g1', 'g1'])).size, 0, '@everyone is not a grant');
  assert.equal(onboardingJustCompleted(member([]), member([], [GuildMemberFlags.CompletedOnboarding])), true);
  assert.equal(onboardingJustCompleted(member([], [GuildMemberFlags.CompletedOnboarding]), member([], [GuildMemberFlags.CompletedOnboarding])), false, 'already completed is not new');
  assert.equal(onboardingJustCompleted({ partial: true, flags: null }, member([], [GuildMemberFlags.CompletedOnboarding])), false, 'a partial old member cannot tell');
  assert.equal(onboardingJustCompleted(member([], [GuildMemberFlags.StartedOnboarding]), member([], [GuildMemberFlags.StartedOnboarding])), false);

  // ---- Who is never touched -----------------------------------------------------------------------------------------------------
  const me = { id: 'bot', roles: { highest: { position: 10 } } };
  assert.equal(safetySkip(member([], [], { top: 3 }), me), null, 'a normal member below Petto');
  assert.equal(safetySkip({ ...member([], [], { top: 3 }), user: { bot: true } }, me), 'bot');
  assert.equal(safetySkip(member([], [], { id: 'bot', top: 3 }), me), 'self');
  assert.equal(safetySkip(member([], [], { id: 'owner', top: 3 }), me), 'owner');
  assert.equal(safetySkip(member([], [], { top: 3, perms: PermissionFlagsBits.Administrator }), me), 'staff');
  assert.equal(safetySkip(member([], [], { top: 3, perms: PermissionFlagsBits.ManageGuild }), me), 'staff');
  assert.equal(safetySkip(member([], [], { top: 3 }), me, { modLevel: 1 }), 'modRole');
  assert.equal(safetySkip(member([], [], { top: 10 }), me), 'hierarchy', 'the same top role as Petto');
  assert.equal(safetySkip(member([], [], { top: 11 }), me), 'hierarchy', 'above Petto');
  assert.equal(safetySkip(member([], [], { top: 3 }), null), 'noBot');

  // ---- Done once ---------------------------------------------------------------------------------------------------------------
  let clock = 1_000;
  const memory = createDoneMemory({ ttlMs: 5 * 60_000, now: () => clock });
  assert.equal(memory.seen('k'), false);
  assert.equal(memory.seen('k'), true, 'the second event of the same grant is ignored');
  clock += 4 * 60_000;
  assert.equal(memory.seen('k'), true, 'still inside the window');
  clock += 2 * 60_000;
  assert.equal(memory.seen('k'), false, 'after the window a new grant counts');
  assert.equal(memory.seen('other'), false, 'another key is independent');

  // ---- The circuit breaker -----------------------------------------------------------------------------------------------------
  clock = 0;
  const breaker = createBreaker({ now: () => clock });
  for (let i = 0; i < 5; i += 1) assert.equal(breaker.allow('g').allowed, true, `action ${i + 1} of 5 runs`);
  let gate = breaker.allow('g');
  assert.deepEqual([gate.allowed, gate.tripped], [false, true], 'the sixth in a minute stops the server and says so once');
  gate = breaker.allow('g');
  assert.deepEqual([gate.allowed, gate.tripped], [false, false], 'paused: no second warning');
  assert.equal(breaker.allow('other').allowed, true, 'another server is not paused');
  clock += 9 * 60_000;
  assert.equal(breaker.allow('g').allowed, false, 'still paused after 9 minutes');
  clock += 2 * 60_000;
  assert.equal(breaker.allow('g').allowed, true, 'runs again after the 10 minute pause');
  clock = 0;
  const slow = createBreaker({ now: () => clock });
  for (let i = 0; i < 20; i += 1) { clock += 20_000; assert.equal(slow.allow('g').allowed, true, 'three a minute never trips it'); }

  // ---- Validation --------------------------------------------------------------------------------------------------------------
  const role = { id: 'R', managed: false };
  const ok = (extra) => validateRule({ role, guildId: 'g1', action: 'ban', ...extra });
  assert.deepEqual(ok({}), { ok: true, rule: { roleId: 'R', action: 'ban', durationMs: null, reason: null, on: 'role_added' } });
  assert.equal(ok({ duration: '1d' }).rule.durationMs, 86_400_000, 'a ban takes a duration (temporary ban)');
  assert.equal(ok({ role: { id: 'g1' } }).error, 'everyone');
  assert.equal(ok({ role: { id: 'R', managed: true } }).error, 'managed');
  assert.equal(ok({ role: null }).error, 'noRole');
  assert.equal(ok({ action: 'explode' }).error, 'badAction');
  assert.equal(ok({ on: 'sometimes' }).error, 'badOn');
  assert.equal(ok({ duration: 'soon' }).error, 'badDuration');
  assert.equal(ok({ action: 'kick', duration: '1h' }).error, 'noDuration');
  assert.equal(ok({ action: 'warn', duration: '1h' }).error, 'noDuration');
  assert.equal(ok({ action: 'remove_role', duration: '1h' }).error, 'noDuration');
  assert.equal(ok({ action: 'mute', duration: '29d' }).error, 'timeoutCap');
  assert.equal(ok({ action: 'mute', duration: '2h' }).ok, true);
  assert.equal(ok({ action: 'jail', duration: '2h' }).ok, true);
  assert.equal(ok({ reason: 'x'.repeat(201) }).error, 'reasonLong');
  assert.equal(ok({ reason: '  because  ' }).rule.reason, 'because');
  const full = Array.from({ length: 25 }, (_, i) => `r${i}`);
  assert.equal(ok({ existingRoleIds: full }).error, 'tooMany', 'the 26th rule is refused');
  assert.equal(ok({ existingRoleIds: [...full.slice(1), 'R'] }).ok, true, 'changing the rule of a role is not a new one');

  // ---- The event path ----------------------------------------------------------------------------------------------------------
  const guildFor = (extra = {}) => {
    const calls = { bans: [], kicks: [], timeouts: [], removed: [], added: [] };
    const guild = {
      id: 'g1', ownerId: 'owner', name: 'Guild', calls, ...extra,
      roles: { cache: new Map([['A', { id: 'A', name: 'Suspicious', editable: true }], ['B', { id: 'B', name: 'Other', editable: true }]]) },
      live: new Map(),
      members: { me: { id: 'bot', roles: { highest: { position: 10 } } }, ban: async (id, options) => { calls.bans.push({ id, options }); }, fetch: async (id) => guild.live.get(id) ?? null },
      client: { user: { id: 'bot', username: 'Petto' } },
      iconURL: () => null,
    };
    guild.client.guilds = { cache: new Map([['g1', guild]]) };
    return guild;
  };
  const live = (guild, id, roles, flagList = [], extra = {}) => {
    const m = member(roles, flagList, { id, guild, top: 3, ...extra });
    m.client = guild.client;
    guild.live.set(id, m);
    m.kick = async (reason) => guild.calls.kicks.push({ id, reason });
    m.timeout = async (ms, reason) => guild.calls.timeouts.push({ id, ms, reason });
    m.roles.remove = async (roleId, reason) => guild.calls.removed.push({ id, roleId, reason });
    m.roles.add = async (r) => guild.calls.added.push({ id, roleId: r.id ?? r });
    return m;
  };
  const reset = () => { Object.assign(state, { rules: [], listCalls: 0, cases: [], warns: [], logs: [], dms: [], sendLogs: [], level: 0, jailError: null, jails: [] }); lib._state.done.clear(); lib._state.breaker.clear(); for (const timer of lib._state.drains.values()) clearTimeout(timer); lib._state.drains.clear(); lib._state.clock.now = () => Date.now(); };

  // Nothing given, nothing finished: no query at all.
  reset();
  state.rules = [rule('A', 'ban')];
  let guild = guildFor();
  await lib.handleMemberUpdate(live(guild, 'u1', ['g1']), live(guild, 'u1', ['g1']));
  await lib.handleMemberUpdate(live(guild, 'u1', ['g1', 'A']), live(guild, 'u1', ['g1', 'A']));
  assert.equal(state.listCalls, 0, 'an update with no new role and no onboarding asks the database for nothing');

  // A role given with a ban rule: banned, the case has Petto as the moderator and the reason names the role.
  await lib.handleMemberUpdate(live(guild, 'u1', ['g1']), live(guild, 'u1', ['g1', 'A']));
  assert.equal(guild.calls.bans.length, 1);
  assert.match(guild.calls.bans[0].options.reason, /Suspicious/);
  assert.deepEqual([state.cases[0].type, state.cases[0].moderatorId, state.cases[0].reason, state.cases[0].source, state.cases[0].expiresAt], ['ban', 'bot', 'Role trigger: Suspicious', 'roletrigger', null]);
  assert.equal(state.logs.length, 1, 'the mod log is written like a manual sanction');
  assert.deepEqual(state.dms, ['ban']);
  // The same grant again (a duplicate update or the role flapping): ignored.
  await lib.handleMemberUpdate(live(guild, 'u1', ['g1']), live(guild, 'u1', ['g1', 'A']));
  assert.equal(guild.calls.bans.length, 1, 'the same grant is handled once');

  // Temporary ban, tempmute (timeout), mute (role), warn, kick, remove_role, jail.
  reset(); guild = guildFor();
  state.rules = [rule('A', 'ban', 'role_added', { duration_ms: 3_600_000, reason: 'raid' })];
  await lib.handleMemberUpdate(live(guild, 'u2', ['g1']), live(guild, 'u2', ['g1', 'A']));
  assert.equal(state.cases[0].type, 'tempban');
  assert.ok(state.cases[0].expiresAt, 'a temporary ban has an expiry for the job that lifts it');
  assert.equal(state.cases[0].reason, 'Role trigger: Suspicious - raid');

  reset(); guild = guildFor();
  state.rules = [rule('A', 'mute', 'role_added', { duration_ms: 600_000 })];
  await lib.handleMemberUpdate(live(guild, 'u2', ['g1']), live(guild, 'u2', ['g1', 'A']));
  assert.deepEqual([guild.calls.timeouts[0].ms, state.cases[0].type], [600_000, 'tempmute']);

  reset(); guild = guildFor();
  state.rules = [rule('A', 'mute')];
  await lib.handleMemberUpdate(live(guild, 'u2', ['g1']), live(guild, 'u2', ['g1', 'A']));
  assert.deepEqual([guild.calls.added[0].roleId, state.cases[0].type], ['mute-role', 'mute']);

  reset(); guild = guildFor();
  state.rules = [rule('A', 'warn')];
  await lib.handleMemberUpdate(live(guild, 'u2', ['g1']), live(guild, 'u2', ['g1', 'A']));
  assert.deepEqual([state.warns[0].source, state.warns[0].moderatorId, state.warns[0].reason], ['roletrigger', 'bot', 'Role trigger: Suspicious']);

  reset(); guild = guildFor();
  state.rules = [rule('A', 'kick')];
  await lib.handleMemberUpdate(live(guild, 'u2', ['g1']), live(guild, 'u2', ['g1', 'A']));
  assert.deepEqual([guild.calls.kicks.length, state.cases[0].type], [1, 'kick']);

  reset(); guild = guildFor();
  state.rules = [rule('A', 'remove_role')];
  await lib.handleMemberUpdate(live(guild, 'u2', ['g1']), live(guild, 'u2', ['g1', 'A']));
  assert.deepEqual([guild.calls.removed[0].roleId, state.cases.length], ['A', 0], 'taking the role away is not a sanction: no case');

  reset(); guild = guildFor();
  state.rules = [rule('A', 'jail', 'role_added', { duration_ms: 60_000 })];
  await lib.handleMemberUpdate(live(guild, 'u2', ['g1']), live(guild, 'u2', ['g1', 'A']));
  assert.deepEqual([state.jails.length, state.jails[0].durationMs, state.logs.length], [1, 60_000, 1], 'jail goes through jailMember');
  reset(); guild = guildFor();
  state.rules = [rule('A', 'jail')];
  state.jailError = 'not set up';
  await lib.handleMemberUpdate(live(guild, 'u2', ['g1']), live(guild, 'u2', ['g1', 'A']));
  assert.equal(state.cases.length + state.logs.length, 0, 'a jail that is not set up is skipped, not crashed');

  // Onboarding: the flag turns on while the member holds the role.
  reset(); guild = guildFor();
  state.rules = [rule('B', 'kick', 'onboarding'), rule('A', 'ban', 'role_added')];
  const done = [GuildMemberFlags.CompletedOnboarding];
  await lib.handleMemberUpdate(live(guild, 'u3', ['g1', 'A', 'B']), live(guild, 'u3', ['g1', 'A', 'B'], done));
  assert.deepEqual([guild.calls.kicks.length, guild.calls.bans.length], [1, 0], 'onboarding fires the onboarding rule of a role the member holds, not the role_added one');
  reset(); guild = guildFor();
  state.rules = [rule('B', 'kick', 'onboarding')];
  await lib.handleMemberUpdate(live(guild, 'u3', ['g1', 'A']), live(guild, 'u3', ['g1', 'A'], done));
  assert.equal(guild.calls.kicks.length, 0, 'finishing onboarding without the role does nothing');
  await lib.handleMemberUpdate(live(guild, 'u3', ['g1', 'B'], done), live(guild, 'u3', ['g1', 'B'], done));
  assert.equal(guild.calls.kicks.length, 0, 'the flag was already on: not a new completion');

  // Never touched: staff, owner, bots, mod levels, above Petto.
  reset(); guild = guildFor();
  state.rules = [rule('A', 'ban')];
  const attempt = (id, extra = {}, rest) => lib.handleMemberUpdate(live(guild, id, ['g1']), live(guild, id, ['g1', 'A'], [], { ...extra, rest }));
  await attempt('admin', { perms: PermissionFlagsBits.Administrator });
  await attempt('owner');
  await attempt('high', { top: 12 });
  await attempt('robot', {}, { user: { bot: true, id: 'robot' } });
  state.level = 2;
  await attempt('modrole');
  assert.equal(guild.calls.bans.length, 0, 'nobody who must be left alone is acted on');
  state.level = 0;
  await attempt('plain');
  assert.equal(guild.calls.bans.length, 1, 'and a plain member still is');

  // The limit through the event: eight members get the role in a minute. Five run now, the other three wait in line (they are not dropped).
  reset(); guild = guildFor();
  let time = 1_000_000; lib._state.clock.now = () => time;
  state.rules = [rule('A', 'kick')];
  for (let i = 0; i < 8; i += 1) await lib.handleMemberUpdate(live(guild, `m${i}`, ['g1']), live(guild, `m${i}`, ['g1', 'A']));
  assert.equal(guild.calls.kicks.length, 5, 'only five actions run in a minute');
  assert.equal(lib._state.breaker.queued('g1'), 3, 'the other three wait in line');
  assert.equal(lib._state.breaker.paused('g1'), false, 'and the rules are not paused');
  assert.equal(state.sendLogs.length, 1, 'the staff is told once');
  const queued = state.sendLogs[0].embed;
  assert.equal(queued.title, 'Role triggers: over the limit');
  assert.match(queued.description, /More than 5 actions in a minute/);
  assert.ok(queued.description.length < 160, 'the description is one short line');
  assert.deepEqual(queued.fields.map((field) => [field.name, field.value, Boolean(field.inline)]), [
    ['Limit', '5 a minute', true],
    ['Waiting', 'Up to 50 members', true],
    ['If the line fills up', 'Rules pause 10 minutes', true],
    ['To stop it', 'Remove the rule (`/protect roletrigger remove`) or take the role away', false],
    ['Raid?', 'Raise the limit with `/protect roletrigger limit`', false],
  ], 'the warning says the limit, how many can wait, what happens if the line fills up, how to stop it and how to raise the limit');
  assert.equal(queued.color, 0xffa94d);
  assert.ok(queued.fields.every((field) => field.value.length < 80), 'every value is a short line');
  // No room yet: the line waits and nobody is acted on.
  await lib.drainOne(guild.client, guild);
  assert.equal(guild.calls.kicks.length, 5, 'the minute has no room yet');
  // A minute later the line moves at the pace of the limit, one after the other, in the order they came.
  time += 61_000;
  await lib.drainOne(guild.client, guild);
  assert.deepEqual(guild.calls.kicks.map((k) => k.id).slice(5), ['m5'], 'the first in line goes first');
  time += 1_000;
  await lib.drainOne(guild.client, guild);
  await lib.drainOne(guild.client, guild);
  assert.deepEqual(guild.calls.kicks.map((k) => k.id).slice(5), ['m5', 'm6', 'm7'], 'and the line empties');
  assert.equal(lib._state.breaker.queued('g1'), 0);
  assert.equal(state.sendLogs.length, 1, 'nobody was left alone, so there is nothing more to tell');

  // Somebody in line is looked at again: the role taken away, the rule removed or a member who left stop their turn.
  reset(); guild = guildFor();
  time = 1_000_000; lib._state.clock.now = () => time;
  state.rules = [rule('A', 'kick')];
  for (let i = 0; i < 9; i += 1) await lib.handleMemberUpdate(live(guild, `w${i}`, ['g1']), live(guild, `w${i}`, ['g1', 'A']));
  assert.equal(lib._state.breaker.queued('g1'), 4);
  time += 61_000;
  guild.live.get('w5').roles.cache.delete('A'); // the role was taken away while it waited
  guild.live.delete('w6'); // left the server
  guild.live.get('w7').user.bot = false;
  await lib.drainOne(guild.client, guild); await lib.drainOne(guild.client, guild); await lib.drainOne(guild.client, guild);
  assert.deepEqual(guild.calls.kicks.map((k) => k.id).slice(5), ['w7'], 'only who still is there with the role is acted on');
  state.rules = [];
  time += 61_000;
  await lib.drainOne(guild.client, guild);
  assert.equal(guild.calls.kicks.length, 6, 'a rule that was removed stops the line');

  // A line that fills up pauses the rules, and who waited is listed with the rest.
  reset(); guild = guildFor();
  time = 1_000_000; lib._state.clock.now = () => time;
  state.rules = [rule('A', 'kick')];
  state.limit = 2;
  for (let i = 0; i < 25; i += 1) await lib.handleMemberUpdate(live(guild, `f${i}`, ['g1']), live(guild, `f${i}`, ['g1', 'A']));
  assert.equal(guild.calls.kicks.length, 2, 'two a minute');
  assert.equal(lib._state.breaker.paused('g1'), true, 'a full line (20 waiting) pauses the rules');
  assert.equal(state.sendLogs.length, 2, 'one message for the line and one for the pause');
  const paused = state.sendLogs[1].embed;
  assert.equal(paused.title, 'Role triggers paused');
  assert.match(paused.description, /paused for 10 minutes/);
  assert.equal(paused.color, 0xff6b6b);
  assert.deepEqual(paused.fields.map((field) => [field.name, field.value, Boolean(field.inline)]), [
    ['Limit', '2 a minute', true],
    ['Next', 'Petto lists whom it did not look at', true],
    ['Raid?', 'Raise the limit with `/protect roletrigger limit`', false],
    ['Mistake?', 'Take the role away and check `/protect roletrigger list`', false],
  ]);
  await lib.summarizeSkipped({}, guild);
  assert.equal(state.sendLogs.length, 3, 'and who was left alone is listed');
  const skipped = state.sendLogs[2].embed;
  assert.equal(skipped.title, 'Members not looked at');
  assert.match(skipped.description, /^\d+ member\(s\) were given a role while the rules were over their limit\.$/);
  assert.equal(skipped.fields.length, 1);
  assert.match(skipped.fields[0].value, /<@f2>/);
  assert.match(skipped.fields[0].value, /<@f24>/);
  assert.equal(skipped.footer.text, 'Check them by hand.');
  assert.doesNotMatch(skipped.description, /<@/, 'the mentions are in the field, not in the description');
  // A long list of members who were not looked at still fits in the one field, with whole mentions and the count of the rest.
  reset(); guild = guildFor();
  time = 1_000_000; lib._state.clock.now = () => time;
  state.rules = [rule('A', 'kick')];
  state.limit = 2;
  for (let i = 0; i < 120; i += 1) await lib.handleMemberUpdate(live(guild, `1234567890123456${String(i).padStart(3, '0')}`, ['g1']), live(guild, `1234567890123456${String(i).padStart(3, '0')}`, ['g1', 'A']));
  await lib.summarizeSkipped({}, guild);
  const longList = state.sendLogs.at(-1).embed;
  assert.equal(longList.title, 'Members not looked at');
  assert.ok(longList.fields[0].value.length <= 1024, 'the mentions fit in a field');
  assert.match(longList.fields[0].value, />( \(\+\d+\))?$/, 'the last mention is whole');
  assert.match(longList.fields[0].value, /\(\+\d+\)$/, 'and the rest is counted');
  state.limit = null;
  lib._state.clock.now = () => Date.now();

  // The limit of the breaker is the default for the size of the server, or the one its admins chose.
  assert.deepEqual([0, 999, 1000, 4999, 5000, 24_999, 25_000, 200_000].map(lib.defaultLimit), [5, 5, 10, 10, 20, 20, 40, 40]);
  assert.deepEqual([0, 1, 500, 501, 2.5, '7', null].map(lib.validLimit), [false, true, true, false, false, false, false]);
  {
    const b = createBreaker();
    for (let i = 0; i < 20; i += 1) assert.equal(b.allow('g', 20, `m${i}`).allowed, true, `${i + 1} of 20`);
    const trip = b.allow('g', 20, 'm20');
    assert.deepEqual([trip.allowed, trip.queued, trip.startedQueue, trip.tripped], [false, true, true, false], 'the 21st waits in line, and the staff is told');
    assert.deepEqual([b.allow('g', 20, 'm21').queued, b.allow('g', 20, 'm22').startedQueue], [true, false], 'the next ones wait too, with no second warning');
    assert.equal(b.queued('g'), 3);
    assert.deepEqual(b.allow('g', 20, 'm23', 'R').queued, true, 'a member who is not in line cannot jump it');
    assert.equal(b.next('g', 20).job, null, 'the minute has no room for the first in line');
    assert.ok(b.next('g', 20).waitMs > 0, 'and says how long to wait');
  }
  reset(); guild = guildFor();
  state.rules = [rule('A', 'kick')];
  state.limit = 8;
  for (let i = 0; i < 12; i += 1) await lib.handleMemberUpdate(live(guild, `n${i}`, ['g1']), live(guild, `n${i}`, ['g1', 'A']));
  assert.equal(guild.calls.kicks.length, 8, 'a server that chose 8 gets 8 actions a minute');
  assert.equal(state.sendLogs.length, 1);
  assert.match(state.sendLogs[0].embed.description, /More than 8 actions/);
  assert.equal(state.sendLogs[0].embed.fields[0].value, '8 a minute');
  assert.match(state.sendLogs[0].embed.fields.find((field) => field.name === 'Raid?').value, /roletrigger limit/, 'the warning says how to raise it');
  assert.equal(lib._state.breaker.queued('g1'), 4, 'the other four wait in line');
  reset(); guild = guildFor({ memberCount: 6000 });
  state.limit = null;
  state.rules = [rule('A', 'kick')];
  for (let i = 0; i < 25; i += 1) await lib.handleMemberUpdate(live(guild, `k${i}`, ['g1']), live(guild, `k${i}`, ['g1', 'A']));
  assert.equal(guild.calls.kicks.length, 20, 'a server of 6,000 members has a default of 20');
  state.limit = null;

  // A role that does not exist any more or a failing action never stops the others.
  reset(); guild = guildFor();
  state.rules = [rule('GONE', 'ban'), rule('A', 'kick')];
  await lib.handleMemberUpdate(live(guild, 'u9', ['g1']), live(guild, 'u9', ['g1', 'GONE', 'A']));
  assert.equal(guild.calls.kicks.length, 1);
  reset(); guild = guildFor();
  state.rules = [rule('A', 'ban')];
  guild.members.ban = async () => { throw new Error('Missing Permissions'); };
  await lib.handleMemberUpdate(live(guild, 'u9', ['g1']), live(guild, 'u9', ['g1', 'A']));
  assert.equal(state.cases.length, 0, 'no case is written for a ban that Discord refused');

  // The reason of the case reads in the language of the one who looks.
  const { displayReason } = require('../src/utils/caseFormat');
  assert.equal(displayReason('Role trigger: Suspicious', 'en'), 'Role trigger: Suspicious');
  assert.equal(displayReason('Role trigger: Suspicious', 'es'), 'Disparador de rol: Suspicious');
  assert.equal(displayReason('Role trigger: Suspicious - raid', 'pt-BR'), 'Gatilho de cargo: Suspicious - raid');

  // ---- Loading the members of the servers with rules (src/utils/roleTriggerWarm.js) ----------------------------------------------
  const warm = require('../src/utils/roleTriggerWarm');
  const d = (over) => warm.warmDecision({ memberCount: 1000, cacheSize: 10, loadLevel: 'normal', ...over });
  assert.equal(d({}), 'warm', 'a small server with an incomplete cache is loaded');
  assert.equal(d({ cacheSize: 1000 }), 'complete', 'a full cache needs nothing');
  assert.equal(d({ cacheSize: 960 }), 'complete', '95 percent counts as complete');
  assert.equal(d({ cacheSize: 900 }), 'warm', 'clearly below the member count is loaded');
  assert.equal(d({ memberCount: warm.MAX_GUILD_MEMBERS }), 'warm', 'exactly at the cap is loaded');
  assert.equal(d({ memberCount: warm.MAX_GUILD_MEMBERS + 1 }), 'too_large', 'above the cap is not loaded');
  assert.equal(d({ memberCount: 50_000, cacheSize: 50_000 }), 'complete', 'a big server with a full cache is fine');
  assert.equal(d({ budgetLeft: 500 }), 'too_large', 'the budget of all servers together is a cap too');
  assert.equal(d({ loadLevel: 'degraded' }), 'load', 'degraded waits');
  assert.equal(d({ loadLevel: 'critical' }), 'load', 'critical waits');
  assert.equal(d({ loadLevel: 'critical', cacheSize: 1000 }), 'complete', 'a complete cache is complete at any load');
  assert.equal(d({ memberCount: undefined }), 'unknown');
  assert.equal(d({ memberCount: 0 }), 'unknown');
  assert.equal(warm.mayMissMembers({ memberCount: 1000, cacheSize: 10 }), true, 'not loaded yet: the admin is told');
  assert.equal(warm.mayMissMembers({ memberCount: 1000, cacheSize: 10, loaded: true }), false, 'loaded: nothing to say');
  assert.equal(warm.mayMissMembers({ memberCount: 1000, cacheSize: 1000 }), false, 'a full cache: nothing to say');
  assert.equal(warm.mayMissMembers({ memberCount: 30_000, cacheSize: 100, loaded: true }), true, 'above the cap: always told');
  assert.equal(warm.mayMissMembers({ memberCount: undefined, cacheSize: 0 }), false, 'no member count: nothing to say');

  // The queue runs one server at a time, with the gap between them, and tries a server skipped for the load again later.
  {
    const order = [];
    const sleeps = [];
    let active = 0;
    let maxActive = 0;
    const timers = [];
    const queue = warm.createWarmQueue({ gapMs: 20_000, retryMs: 300_000, retryMax: 2, sleep: async (ms) => { sleeps.push(ms); }, timer: (fn, ms) => { timers.push({ fn, ms }); return null; } });
    const job = (name, result) => async () => { active += 1; maxActive = Math.max(maxActive, active); await new Promise((r) => setImmediate(r)); order.push(name); active -= 1; return result; };
    assert.equal(queue.push('a', job('a')), true);
    assert.equal(queue.push('a', job('a2')), false, 'the same server is not queued twice');
    queue.push('b', job('b'));
    queue.push('c', job('c', 'retry'));
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
    assert.deepEqual(order, ['a', 'b', 'c']);
    assert.equal(maxActive, 1, 'never two at once');
    assert.deepEqual(sleeps, [20_000, 20_000], 'a gap between servers, none before the first');
    assert.deepEqual(timers.map((x) => x.ms), [300_000], 'the one skipped for the load is tried again after 5 minutes');
    timers[0].fn();
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(order.at(-1), 'c', 'the retry ran');
    assert.equal(timers.length, 2, 'and may be tried once more');
    timers[1].fn();
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(timers.length, 2, 'but not forever');
  }

  // guildMemberAvailable only writes a console line and never applies an action.
  {
    const availableListener = require('../src/events/guildMemberAvailableRoleTriggers');
    assert.equal(availableListener.name, 'guildMemberAvailable');
    const before = { cases: state.cases.length, warns: state.warns.length, jails: state.jails.length };
    state.rules = [{ guild_id: 'g1', role_id: 'A', action: 'ban', duration_ms: null, reason: null, on_event: 'role_added' }];
    const logged = [];
    const logger = require('../src/utils/logger');
    const originalLocalWarn = logger.localWarn;
    logger.localWarn = (...args) => logged.push(args.join(' '));
    try {
      const held = { id: 'u1', user: { bot: false }, guild: { id: 'g1' }, roles: { cache: new Map([['A', {}]]) } };
      await availableListener.execute(held);
      assert.equal(logged.length, 1, 'a holder of a rule role is logged');
      await availableListener.execute({ ...held, roles: { cache: new Map([['Z', {}]]) } });
      await availableListener.execute({ ...held, user: { bot: true } });
      assert.equal(logged.length, 1, 'no role of a rule, or a bot: no line');
      state.rules = [];
      await availableListener.execute(held);
      assert.equal(logged.length, 1, 'no rules in the server: no line');
    } finally { logger.localWarn = originalLocalWarn; }
    assert.deepEqual({ cases: state.cases.length, warns: state.warns.length, jails: state.jails.length }, before, 'no action was applied');
  }

  // The three alert embeds read well in the three languages: every title, field and value exists, is translated and fits Discord's limits.
  {
    const keys = Object.keys(require('../src/i18n/locales/en/automation.js')).filter((key) => key.startsWith('automation.roletrigger.alert.'));
    assert.equal(keys.length, 22, 'the texts of the three alerts');
    assert.equal(Object.keys(require('../src/i18n/locales/en/automation.js')).some((key) => /^automation\.roletrigger\.(queued|breaker|skipped)$/.test(key)), false, 'the old long paragraphs are gone');
    for (const lang of ['es', 'pt-BR']) {
      const catalog = require(`../src/i18n/locales/${lang}/automation.js`);
      const english = require('../src/i18n/locales/en/automation.js');
      for (const key of keys) {
        assert.ok(catalog[key], `${key} in ${lang}`);
        assert.ok(catalog[key].length <= (/(\.title|\.description|\.footer)$/.test(key) ? 200 : 120), `${key} stays short in ${lang}`);
        if (!/\.(limitValue)$/.test(key)) assert.notEqual(catalog[key], english[key], `${key} is translated in ${lang}`);
        assert.deepEqual(catalog[key].match(/\{\w+\}/g)?.sort(), english[key].match(/\{\w+\}/g)?.sort(), `${key} keeps its placeholders in ${lang}`);
      }
    }
  }
  // The note for the admin exists in the three languages.
  for (const lang of ['en', 'es', 'pt-BR']) {
    const text = require(`../src/i18n/locales/${lang}/automation.js`)['automation.roletrigger.coverage'];
    assert.ok(text && text.includes('{max}'), `coverage note in ${lang}`);
  }

  // The listener is registered on guildMemberUpdate and the command is Administrator-only.
  assert.equal(require('../src/events/guildMemberUpdateRoleTriggers').name, 'guildMemberUpdate');
  assert.equal(String(require('../src/commands/automation/roletrigger').data.toJSON().default_member_permissions), String(PermissionFlagsBits.Administrator));

  console.log('Role trigger checks passed.');
})().catch((err) => { console.error(err); process.exit(1); });
