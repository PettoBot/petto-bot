// Checks the role of the most active member of the week: which week is "the one that just ended" (Monday to Sunday, GMT-5), which roles Petto may hand out, giving the role
// to the number 1 and taking it from the one who had it, who is left out (bots, who asked not to be counted, who left), the reasons it cannot be given, the job that goes
// through the roles that are due, and the subcommands of /activityboard (role-set, role-remove, role-status).
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, PermissionFlagsBits, MessageFlags } = require('discord.js');
const i18n = require('../src/i18n');
const leaderboards = require('../src/db/activityLeaderboards');
const rolesDb = require('../src/db/activityTopRoles');
const statsRules = require('../src/db/statsRules');
const topRole = require('../src/utils/activityTopRole');
const command = require('../src/commands/info/activityboard.js');

const GUILD = '111111111111111111';
const ROLE = '333333333333333333';
i18n.setCachedGuildLanguage(GUILD, 'en');
const text = (payload) => JSON.stringify(payload.components[0].toJSON());

(async () => {
  // ---- the week that just ended
  assert.deepEqual(topRole.lastWeek(new Date('2026-11-12T03:00:00Z')), { week: '2026-11-02', until: '2026-11-09' }, 'on Wednesday it is last week: Monday 2 to Sunday 8');
  assert.deepEqual(topRole.lastWeek(new Date('2026-11-09T05:30:00Z')), { week: '2026-11-02', until: '2026-11-09' }, 'half an hour after the midnight of Monday in Colombia, the week that finished');
  assert.deepEqual(topRole.lastWeek(new Date('2026-11-09T04:59:00Z')), { week: '2026-10-26', until: '2026-11-02' }, 'a minute before it, the week that finished is the one before');
  assert.deepEqual(topRole.lastWeek(new Date('2027-01-05T12:00:00Z')), { week: '2026-12-28', until: '2027-01-04' }, 'a week across the new year');

  // ---- the server, its members and the roles
  const botPosition = 10;
  const permissions = { ManageRoles: true };
  const me = { id: 'bot', permissions: { has: (flag) => flag === PermissionFlagsBits.ManageRoles && permissions.ManageRoles }, roles: { highest: { comparePositionTo: (role) => botPosition - role.position } } };
  const calls = { added: [], removed: [], fetched: [], addError: null, removeError: null };
  const members = new Collection();
  const addMember = (id, { bot = false, roles = [] } = {}) => members.set(id, {
    id, user: { id, username: `name_${id}`, bot },
    roles: { cache: new Set(roles), add: async (role, reason) => { if (calls.addError) throw calls.addError; calls.added.push([id, role, reason]); members.get(id).roles.cache.add(role); }, remove: async (role, reason) => { if (calls.removeError) throw calls.removeError; calls.removed.push([id, role, reason]); members.get(id).roles.cache.delete(role); } },
  });
  for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) addMember(id);
  members.get('m2').user.bot = true;
  const roleObject = (extra = {}) => ({ id: ROLE, position: 5, managed: false, ...extra });
  let role = roleObject();
  const guild = {
    id: GUILD, name: 'Petto Land',
    members: { cache: members, me, fetch: async (query) => { calls.fetched.push(query); return typeof query === 'string' ? members.get(query) ?? null : new Collection(); } },
    roles: { cache: { get: (id) => (id === ROLE ? role : undefined) }, fetch: async (id) => (id === ROLE ? role : null) },
  };
  const client = { guilds: { cache: new Map([[GUILD, guild]]) } };

  // ---- which roles Petto may hand out
  assert.equal(topRole.roleProblem(guild, role), null, 'a normal role below the roles of Petto');
  assert.equal(topRole.roleProblem(guild, null), 'role', 'a role that does not exist');
  assert.equal(topRole.roleProblem(guild, roleObject({ id: GUILD })), 'role', '@everyone');
  assert.equal(topRole.roleProblem(guild, roleObject({ managed: true })), 'role', 'the role of a bot or of boosters');
  assert.equal(topRole.roleProblem(guild, roleObject({ position: 10 })), 'permissions', 'as high as the highest role of Petto');
  assert.equal(topRole.roleProblem(guild, roleObject({ position: 11 })), 'permissions', 'above it');
  permissions.ManageRoles = false;
  assert.equal(topRole.roleProblem(guild, role), 'permissions', 'without Manage Roles');
  permissions.ManageRoles = true;

  // ---- the database is replaced: what it would be asked, and what it answers
  const saved = { awarded: [], errors: [] };
  const asked = [];
  let top = [{ user_id: 'm2', amount: 90 }, { user_id: 'gone', amount: 80 }, { user_id: 'm3', amount: 70 }, { user_id: 'm1', amount: 60 }];
  leaderboards.readTopBetween = async (...args) => { asked.push(args); return top; };
  rolesDb.markAwarded = async (guildId, kind, week, holder) => { saved.awarded.push([guildId, kind, week, holder]); };
  rolesDb.markError = async (_guild, _kind, code) => { saved.errors.push(code); };
  const row = (extra = {}) => ({ guild_id: GUILD, kind: 'chat', role_id: ROLE, holder_id: null, awarded_week: null, last_error: null, ...extra });
  const reset = () => { calls.added.length = 0; calls.removed.length = 0; calls.fetched.length = 0; calls.addError = null; calls.removeError = null; saved.awarded.length = 0; saved.errors.length = 0; asked.length = 0; };
  const when = new Date('2026-11-12T03:00:00Z');
  statsRules.setForTests({ configs: new Map(), optedOut: new Set(['m3']) });

  // The number 1 of last week gets the role; a bot, who asked not to be counted and who left are skipped.
  let result = await topRole.awardRole(client, row(), { now: when });
  assert.deepEqual(result, { ok: true, winner: 'm1' }, 'the first one who can be: not the bot (m2), not who left, not who asked not to be counted (m3)');
  assert.deepEqual(asked[0].slice(0, 5), [GUILD, 'chat', '2026-11-02', '2026-11-09', 30], 'it reads the week that ended, from Monday up to the next Monday');
  assert.deepEqual(calls.added.map(([id, roleId]) => [id, roleId]), [['m1', ROLE]], 'the role goes to the winner');
  assert.ok(calls.added[0][2].includes('2026-11-02'), 'with the week as the reason in the audit log');
  assert.deepEqual(saved.awarded, [[GUILD, 'chat', '2026-11-02', 'm1']], 'and the week and the holder are remembered');
  assert.deepEqual(calls.fetched, [{ user: ['gone'] }], 'the member that is not in the cache is asked for once');

  // The next week: the new winner gets it and the old one loses it.
  reset();
  top = [{ user_id: 'm4', amount: 10 }, { user_id: 'm1', amount: 9 }];
  result = await topRole.awardRole(client, row({ holder_id: 'm1', awarded_week: '2026-11-02' }), { now: new Date('2026-11-19T10:00:00Z') });
  assert.deepEqual(result, { ok: true, winner: 'm4' });
  assert.deepEqual([calls.added.map((entry) => entry[0]), calls.removed.map((entry) => entry[0])], [['m4'], ['m1']], 'the winner gets it and who had it loses it');
  assert.deepEqual(saved.awarded, [[GUILD, 'chat', '2026-11-09', 'm4']]);
  assert.equal(asked[0][2], '2026-11-09');

  // The same one wins twice: nothing is added or taken.
  reset();
  top = [{ user_id: 'm4', amount: 10 }];
  result = await topRole.awardRole(client, row({ holder_id: 'm4', awarded_week: '2026-11-09' }), { now: new Date('2026-11-26T10:00:00Z') });
  assert.deepEqual([result.winner, calls.added.length, calls.removed.length], ['m4', 0, 0], 'who already has the role keeps it, nothing is touched');
  assert.deepEqual(saved.awarded.map((entry) => entry[2]), ['2026-11-16']);

  // Nobody was active: the role is taken from who had it and stays with nobody.
  reset();
  top = [];
  result = await topRole.awardRole(client, row({ holder_id: 'm4' }), { now: when });
  assert.deepEqual([result.ok, result.winner, calls.removed.map((entry) => entry[0]), calls.added.length], [true, null, ['m4'], 0], 'a quiet week gives it to nobody');
  assert.deepEqual(saved.awarded, [[GUILD, 'chat', '2026-11-02', null]]);

  // The holder left the server: nothing to take, the week is still done.
  reset();
  top = [{ user_id: 'm5', amount: 4 }];
  result = await topRole.awardRole(client, row({ holder_id: 'left' }), { now: when });
  assert.deepEqual([result.ok, result.winner, calls.added.length], [true, 'm5', 1], 'who had it and left is not a problem');

  // Voice reads the voice.
  reset();
  await topRole.awardRole(client, row({ kind: 'voice' }), { now: when });
  assert.equal(asked[0][1], 'voice', 'the voice role reads the voice');

  // ---- the reasons it cannot be given are saved, and nothing throws
  reset();
  top = [{ user_id: 'm5', amount: 4 }];
  members.get('m5').roles.cache.clear(); // m5 would win and does not have the role
  statsRules.setForTests({ configs: new Map([[GUILD, { enabled: false, members: true, content: true }]]), optedOut: new Set() });
  assert.deepEqual(await topRole.awardRole(client, row(), { now: when }), { ok: false, reason: 'statsOff' });
  statsRules.setForTests({ configs: new Map([[GUILD, { enabled: true, members: false, content: true }]]), optedOut: new Set() });
  assert.equal((await topRole.awardRole(client, row(), { now: when })).reason, 'membersOff');
  statsRules.setForTests({ configs: new Map(), optedOut: new Set() });
  role = null;
  assert.equal((await topRole.awardRole(client, row(), { now: when })).reason, 'role', 'the role was deleted');
  role = roleObject({ position: 12 });
  assert.equal((await topRole.awardRole(client, row(), { now: when })).reason, 'permissions', 'the role is above Petto now');
  role = roleObject();
  calls.addError = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  assert.equal((await topRole.awardRole(client, row(), { now: when })).reason, 'permissions', 'Discord refuses');
  calls.addError = Object.assign(new Error('Unknown Role'), { code: 10011 });
  assert.equal((await topRole.awardRole(client, row(), { now: when })).reason, 'role', 'the role is deleted while giving it');
  calls.addError = new Error('boom');
  assert.equal((await topRole.awardRole(client, row(), { now: when })).reason, 'error', 'any other failure is kept as a plain one');
  assert.deepEqual(saved.errors, ['statsOff', 'membersOff', 'role', 'permissions', 'permissions', 'role', 'error']);
  assert.equal(saved.awarded.length, 0, 'and none of them counts the week as given');
  calls.addError = null;
  reset();
  assert.deepEqual(await topRole.awardRole({ guilds: { cache: new Map() } }, row(), { now: when }), { ok: false, reason: 'error' });
  assert.deepEqual(saved.errors, [], 'a server that is not reachable now is not blamed: it is looked at again');

  // ---- the job: the roles that are due, one after another, and one that fails does not stop the others
  reset();
  let dueFor = null;
  rolesDb.listDue = async (week) => { dueFor = week; return [row({ kind: 'chat' }), row({ guild_id: '999999999999999999', kind: 'voice' }), row({ kind: 'voice' })]; };
  top = [{ user_id: 'm5', amount: 4 }];
  members.get('m5').roles.cache.clear();
  const pauses = [];
  const ran = await topRole.runDueRoles(client, { now: when, pauseMs: 1500, sleep: async (ms) => { pauses.push(ms); } });
  assert.equal(dueFor, '2026-11-02', 'the job asks for the roles not given for the week that ended');
  assert.deepEqual([ran, pauses], [3, [1500, 1500, 1500]], 'a pause after each one');
  assert.equal(saved.awarded.length, 2, 'the two that can be reached were given, the other server was skipped');

  // ---- the subcommands
  let stored = null;
  let removedRow = null;
  const listed = [];
  rolesDb.upsertRole = async (guildId, kind, roleId) => { stored = { guildId, kind, roleId }; return row({ kind, role_id: roleId }); };
  rolesDb.removeRole = async () => removedRow;
  rolesDb.listRoles = async () => listed;
  const interaction = (sub, opts = {}, { allowed = true } = {}) => {
    const log = { replies: [], edits: [], deferred: 0 };
    return {
      log,
      value: {
        guild, guildId: GUILD, client, locale: 'en-US', guildLocale: 'en-US', user: { id: 'u' },
        memberPermissions: { has: (flag) => allowed && flag === PermissionFlagsBits.ManageGuild },
        options: { getSubcommand: () => sub, getString: (name) => opts[name] ?? null, getRole: () => ({ id: opts.roleId ?? ROLE }) },
        deferred: false, replied: false,
        deferReply: async function defer() { log.deferred += 1; this.deferred = true; },
        reply: async function reply(payload) { log.replies.push(payload); this.replied = true; },
        editReply: async (payload) => { log.edits.push(payload); },
      },
    };
  };
  const run = async (sub, opts, flags) => { const made = interaction(sub, opts, flags); await command.execute(made.value); return made.log; };

  let log = await run('role-set', { type: 'chat' }, { allowed: false });
  assert.ok(text(log.replies[0]).includes('Manage Server') && stored === null, 'only who has Manage Server');
  assert.equal(log.replies[0].flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral, 'the refusal is private');
  reset();
  log = await run('role-set', { type: 'chat' });
  assert.deepEqual(stored, { guildId: GUILD, kind: 'chat', roleId: ROLE }, 'the role is saved');
  assert.ok(text(log.replies[0]).includes('<@&333333333333333333>') && text(log.replies[0]).includes('most active member'), 'the answer says which role and when it is given');
  stored = null;
  role = roleObject({ position: 11 });
  log = await run('role-set', { type: 'chat' });
  assert.ok(text(log.replies[0]).includes('Manage Roles') && stored === null, 'a role above Petto is refused before saving');
  role = roleObject({ managed: true });
  log = await run('role-set', { type: 'chat' });
  assert.ok(text(log.replies[0]).includes('cannot be used') && stored === null, 'the role of a bot is refused');
  role = roleObject();
  statsRules.setForTests({ configs: new Map([[GUILD, { enabled: false, members: true, content: true }]]), optedOut: new Set() });
  log = await run('role-set', { type: 'voice' });
  assert.ok(text(log.replies[0]).includes('statistics off') && stored === null, 'a server with statistics off is told and nothing is saved');
  statsRules.setForTests({ configs: new Map(), optedOut: new Set() });

  // Changing the role takes the old one from who has it.
  reset();
  listed.push(row({ role_id: '444444444444444444', holder_id: 'm4' }));
  members.get('m4').roles.cache.add('444444444444444444');
  await run('role-set', { type: 'chat' });
  assert.deepEqual(calls.removed.map(([id, roleId]) => [id, roleId]), [['m4', '444444444444444444']], 'the old role does not stay on someone');
  listed.length = 0;

  removedRow = null;
  log = await run('role-remove', { type: 'chat' });
  assert.ok(text(log.replies[0]).includes('no role for the most active member of the **chat**'), 'nothing to remove');
  reset();
  members.get('m4').roles.cache.add(ROLE);
  removedRow = row({ holder_id: 'm4' });
  log = await run('role-remove', { type: 'chat' });
  assert.deepEqual(calls.removed.map(([id, roleId]) => [id, roleId]), [['m4', ROLE]], 'the role is taken from who had it');
  assert.ok(text(log.edits.at(-1)).includes('taken away'));

  log = await run('role-status');
  assert.ok(text(log.replies[0]).includes('/activityboard role-set'), 'no roles yet');
  listed.push(row({ holder_id: 'm1' }), row({ kind: 'voice', last_error: 'permissions' }));
  log = await run('role-status');
  const status = text(log.replies[0]);
  assert.ok(status.includes('<@&333333333333333333>') && status.includes('<@m1>') && status.includes('nobody has it yet') && status.includes('Manage Roles'), 'the role, who has it and what is wrong');

  // ---- the three languages say every word
  for (const lang of ['en', 'es', 'pt-BR']) {
    for (const key of ['leaderboards.role.reason', 'leaderboards.role.removedReason', 'leaderboards.role.set.done', 'leaderboards.role.remove.none', 'leaderboards.role.remove.done', 'leaderboards.role.status.none', 'leaderboards.role.status.line', 'leaderboards.role.status.holder', 'leaderboards.role.status.nobody', 'leaderboards.roleError.statsOff', 'leaderboards.roleError.membersOff', 'leaderboards.roleError.role', 'leaderboards.roleError.permissions', 'leaderboards.roleError.error']) {
      const said = i18n.t(lang, key, { emoji: 'E', kind: 'k', role: 'R', user: 'U', week: 'W' });
      assert.ok(said && said !== key && !/\{\w+\}/.test(said), `${lang}: ${key}`);
    }
  }

  // ---- the pieces are in place
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.ok(/create table if not exists activity_top_roles/.test(read('src/db/schema.sql')), 'the table');
  assert.ok(/runDueRoles\(client\)/.test(read('src/jobs/activityLeaderboardJob.ts')), 'the job gives the roles');
  console.log('Activity top role checks passed (the week, the roles Petto may give, the winner and who loses it, the reasons it fails, the job, the subcommands, the words).');
})().catch((err) => { console.error(err); process.exit(1); });
