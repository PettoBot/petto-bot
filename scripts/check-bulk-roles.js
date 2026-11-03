// Checks the roles upgrade: the rules of a bulk role job (who it is for, whether it can run, the dates, the time left, the card), the engine that runs it
// (pages of members, preview, cancel, resume from a cursor, refusals, a member who left), the options of the `/role` mass subcommands and the groups
// `/role join` and `/role sticky`, how the prefix reads them, the temporary roles that are cleared when a role is given or taken by hand, and the join
// roles that wait for the rules. Discord and the database are replaced by fakes.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Collection, PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// ---- the database, in memory --------------------------------------------------------------------------------------------
const jobs = new Map();
const temp = [];
const joinRows = [];
const bulkDb = {
  getJob: async (id) => ({ ...jobs.get(id) }),
  updateJob: async (id, patch) => { Object.assign(jobs.get(id), patch); },
  finishJob: async (id, patch) => { if (jobs.get(id).status === 'running') Object.assign(jobs.get(id), patch, { finished_at: 'now' }); },
  requeueRunning: async () => 0,
  listPending: async () => [],
  getActiveJob: async () => null,
  listRecent: async () => [],
  createJob: async (row) => { const job = { id: jobs.size + 1, status: 'pending', ...row }; jobs.set(job.id, job); return job; },
  cancelJob: async () => {},
  setPaused: async () => true,
};
stub('src/db/bulkRoleJobs.js', bulkDb);
stub('src/db/tempRoles.js', { clearTempRoles: async (guild, user, roles) => { temp.push([guild, user, ...roles]); return 1; }, addTempRole: async () => {}, listTempRoles: async () => [], removeTempRole: async () => true, getExpiredTempRoles: async () => [] });
stub('src/db/guilds.js', { ensureGuild: async () => {}, findGuildLanguage: async () => null });
stub('src/db/joinRoles.js', { listRoles: async () => joinRows, removeRole: async () => true, addRole: async () => ({}), clearRoles: async () => 0 });
const warnings = [];
stub('src/utils/logger.js', { info() {}, warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) });
stub('src/utils/caseCard.js', { textCard: (text, color) => ({ text, color }) });

const plan = require('../src/utils/bulkRolePlan');
const { processBulkRoleJob } = require('../src/utils/bulkRoleEngine');

const member = (id, { bot = false, roles = [], joined = Date.UTC(2025, 0, 10), pending = false } = {}) => {
  const cache = new Collection([['999', { id: '999' }], ...roles.map((role) => [role, { id: role }])]);
  const calls = [];
  return {
    id, user: { bot }, pending, joinedTimestamp: joined, calls,
    roles: {
      cache,
      add: async (role) => { calls.push(['add', role]); cache.set(role, { id: role }); },
      remove: async (role) => { calls.push(['remove', role]); cache.delete(role); },
    },
  };
};
const baseJob = (extra = {}) => ({
  id: 1, guild_id: '999', action: 'add', target_role_id: '500', member_type: 'all', filter_role_ids: [], filter_mode: 'any', filter_exclude: false,
  joined_after: null, joined_before: null, min_roles: null, max_roles: null, skip_pending: false, dry_run: false, reason: null, started_by: '7',
  status: 'pending', total_members: 0, processed_members: 0, success_count: 0, skipped_count: 0, error_count: 0, cursor_id: null, notify_channel_id: null,
  progress_channel_id: null, progress_message_id: null, paused: false, ...extra,
});

(async () => {
  // ---- who a job is for ----------------------------------------------------------------------------------------------------
  const human = member('10');
  const bot = member('11', { bot: true });
  assert.equal(plan.classifyMember(human, baseJob()), 'change');
  assert.equal(plan.classifyMember(member('12', { roles: ['500'] }), baseJob()), 'noop', 'already has the role: nothing to give');
  assert.equal(plan.classifyMember(member('12', { roles: ['500'] }), baseJob({ action: 'remove' })), 'change');
  assert.equal(plan.classifyMember(human, baseJob({ action: 'remove' })), 'noop');
  assert.equal(plan.classifyMember(bot, baseJob({ member_type: 'humans' })), 'filtered');
  assert.equal(plan.classifyMember(human, baseJob({ member_type: 'bots' })), 'filtered');
  assert.equal(plan.classifyMember(member('13', { roles: ['1'] }), baseJob({ filter_role_ids: ['1', '2'] })), 'change', 'has any of the roles');
  assert.equal(plan.classifyMember(member('13', { roles: ['1'] }), baseJob({ filter_role_ids: ['1', '2'], filter_mode: 'all' })), 'filtered', 'has all of the roles');
  assert.equal(plan.classifyMember(member('13', { roles: ['1'] }), baseJob({ filter_role_ids: ['1'], filter_exclude: true })), 'filtered', 'only the ones without it');
  assert.equal(plan.classifyMember(human, baseJob({ filter_role_ids: ['1'], filter_exclude: true })), 'change');
  assert.equal(plan.classifyMember(member('14', { roles: ['1', '2'] }), baseJob({ max_roles: 1 })), 'filtered', 'at most one role');
  assert.equal(plan.classifyMember(member('14'), baseJob({ max_roles: 0 })), 'change', 'no roles at all (@everyone does not count)');
  assert.equal(plan.classifyMember(member('14'), baseJob({ min_roles: 1 })), 'filtered');
  assert.equal(plan.classifyMember(member('15', { pending: true }), baseJob({ skip_pending: true })), 'filtered', 'a member who has not accepted the rules');
  assert.equal(plan.classifyMember(member('15', { pending: true }), baseJob()), 'change');
  assert.equal(plan.classifyMember(human, baseJob({ joined_after: '2025-02-01T00:00:00.000Z' })), 'filtered');
  assert.equal(plan.classifyMember(human, baseJob({ joined_before: '2025-02-01T00:00:00.000Z' })), 'change');

  // ---- whether it can run --------------------------------------------------------------------------------------------------
  const me = (position, manage = true) => ({ permissions: { has: (flag) => manage && flag === PermissionFlagsBits.ManageRoles }, roles: { highest: { position } } });
  assert.equal(plan.checkTargetRole({ guildId: '999', role: { id: '500', position: 3 }, botMember: me(5) }), null);
  assert.equal(plan.checkTargetRole({ guildId: '999', role: { id: '500', position: 3 }, botMember: me(5, false) }), 'missing_permission');
  assert.equal(plan.checkTargetRole({ guildId: '999', role: null, botMember: me(5) }), 'role_gone');
  assert.equal(plan.checkTargetRole({ guildId: '999', role: { id: '999', position: 0 }, botMember: me(5) }), 'role_everyone');
  assert.equal(plan.checkTargetRole({ guildId: '999', role: { id: '500', position: 3, managed: true }, botMember: me(5) }), 'role_managed');
  assert.equal(plan.checkTargetRole({ guildId: '999', role: { id: '500', position: 5 }, botMember: me(5) }), 'role_above_bot');
  for (const code of Object.keys(plan.ERROR_CODES)) assert.ok(plan.ERROR_CODES[code], `${code} has its English text`);
  assert.ok(plan.dangerousBits({ permissions: { bitfield: PermissionFlagsBits.Administrator | PermissionFlagsBits.SendMessages } }) === PermissionFlagsBits.Administrator, 'only the risky bits');
  assert.equal(plan.dangerousBits({ permissions: { bitfield: PermissionFlagsBits.SendMessages } }), 0n);

  // ---- the dates people type -----------------------------------------------------------------------------------------------
  assert.equal(plan.parseJoinedInput(''), null);
  assert.equal(plan.parseJoinedInput('2025-03-01'), '2025-03-01T00:00:00.000Z');
  assert.equal(plan.parseJoinedInput('2025-02-30'), undefined, 'a day that does not exist');
  assert.equal(plan.parseJoinedInput('soon'), undefined);
  assert.equal(plan.parseJoinedInput('30d', Date.UTC(2025, 2, 31)), '2025-03-01T00:00:00.000Z', 'a time back from now');

  // ---- the time that is left and the card ----------------------------------------------------------------------------------
  assert.equal(plan.etaMs({ started_at: '2025-01-01T00:00:00Z', processed_members: 10, total_members: 100 }, Date.parse('2025-01-01T00:01:00Z')), null, 'too little to tell');
  assert.equal(plan.etaMs({ started_at: '2025-01-01T00:00:00Z', processed_members: 50, total_members: 100 }, Date.parse('2025-01-01T00:01:00Z')), 60000);
  const card = plan.buildCardText('en', baseJob({ status: 'completed', processed_members: 40, total_members: 40, success_count: 30, skipped_count: 8, error_count: 2, started_at: '2025-01-01T00:00:00Z', finished_at: '2025-01-01T00:02:00Z', reason: 'cleanup' }));
  assert.match(card.text, /Giving <@&500>/);
  assert.match(card.text, /Changed \*\*30\*\* · already fine \*\*8\*\* · failed \*\*2\*\*/);
  assert.match(card.text, /Took 2 minutes/);
  assert.match(card.text, /Reason: cleanup/);
  const previewCard = plan.buildCardText('es', baseJob({ status: 'completed', dry_run: true, processed_members: 40, total_members: 40, success_count: 30, skipped_count: 5 }));
  assert.match(previewCard.text, /Vista previa/);
  assert.match(previewCard.text, /no coinciden \*\*5\*\*/);
  const failedCard = plan.buildCardText('pt-BR', baseJob({ status: 'failed', error_code: 'role_above_bot' }));
  assert.match(failedCard.text, /acima do meu cargo/);
  assert.match(plan.buildCardText('en', baseJob({ status: 'running', paused: true })).text, /paused/);
  assert.match(plan.buildCardText('en', baseJob({ status: 'running' }), { dangerous: PermissionFlagsBits.Administrator }).text, /Administrator/);

  // ---- the engine ----------------------------------------------------------------------------------------------------------
  const makeGuild = (members, { roleAbove = false, listFails = false } = {}) => {
    const all = new Collection(members.map((each) => [each.id, each]));
    const role = { id: '500', position: roleAbove ? 9 : 3, managed: false };
    return {
      id: '999', memberCount: members.length,
      members: {
        fetchMe: async () => me(5),
        list: async ({ limit, after }) => {
          if (listFails) throw new Error('list refused');
          const sorted = [...all.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).filter((each) => BigInt(each.id) > BigInt(after));
          return new Collection(sorted.slice(0, limit).map((each) => [each.id, each]));
        },
        fetch: async () => all,
      },
      roles: { fetch: async () => role },
      channels: { fetch: async () => null },
    };
  };
  const clientOf = (guild) => ({ guilds: { fetch: async () => guild }, users: { cache: new Map([['7', { tag: 'Ana#0001' }]]) }, channels: { fetch: async () => { throw new Error('no channel'); } } });
  const run = async (members, jobExtra = {}, guildOptions = {}) => {
    jobs.clear(); temp.length = 0; warnings.length = 0;
    const job = baseJob(jobExtra);
    jobs.set(job.id, { ...job });
    await processBulkRoleJob(clientOf(makeGuild(members, guildOptions)), { ...job });
    return jobs.get(job.id);
  };

  const crowd = [member('10'), member('11', { bot: true }), member('12', { roles: ['500'] }), member('13'), member('14', { pending: true })];
  let result = await run(crowd, { member_type: 'humans' });
  assert.equal(result.status, 'completed');
  assert.deepEqual([result.processed_members, result.success_count, result.skipped_count, result.error_count], [5, 3, 1, 0], 'the bot is left out, the one who had it is skipped');
  assert.deepEqual(crowd[0].calls, [['add', '500']]);
  assert.deepEqual(crowd[1].calls, [], 'a bot is not touched by a job for humans');
  assert.equal(temp.length, 3, 'the temporary rows of the role are cleared for each member who got it');

  const preview = [member('10'), member('12', { roles: ['500'] }), member('13')];
  result = await run(preview, { dry_run: true });
  assert.equal(result.status, 'completed');
  assert.deepEqual([result.success_count, result.skipped_count], [2, 1]);
  assert.ok(preview.every((each) => each.calls.length === 0), 'a preview changes nothing');

  // A job that was cut goes on from its cursor and keeps its counts.
  const resumed = [member('10'), member('11'), member('12'), member('13')];
  result = await run(resumed, { cursor_id: '11', processed_members: 2, success_count: 2 });
  assert.equal(result.processed_members, 4);
  assert.equal(result.success_count, 4);
  assert.deepEqual([resumed[0].calls.length, resumed[1].calls.length, resumed[2].calls.length], [0, 0, 1], 'the members before the cursor are not asked again');

  // More than one page of members (1000 each) and the order of the cursor.
  const many = Array.from({ length: 2300 }, (_, index) => member(String(1000 + index), { roles: index % 2 ? ['500'] : [] }));
  result = await run(many);
  assert.deepEqual([result.processed_members, result.success_count, result.skipped_count], [2300, 1150, 1150]);
  assert.equal(result.cursor_id, '3299');

  // The list of Discord refused: the full fetch is read in pages instead.
  result = await run([member('10'), member('13')], {}, { listFails: true });
  assert.deepEqual([result.status, result.success_count], ['completed', 2]);

  // Refusals: a member who left is skipped; a role Discord keeps refusing stops the job with a code.
  const leaver = member('10'); leaver.roles.add = async () => { const error = new Error('Unknown Member'); error.code = 10007; throw error; };
  result = await run([leaver, member('11')]);
  assert.deepEqual([result.status, result.success_count, result.skipped_count, result.error_count], ['completed', 1, 1, 0]);
  const refusing = Array.from({ length: 20 }, (_, index) => { const each = member(String(100 + index)); each.roles.add = async () => { const error = new Error('Missing Permissions'); error.code = 50013; throw error; }; return each; });
  result = await run(refusing);
  assert.deepEqual([result.status, result.error_code], ['failed', 'permission_lost']);
  assert.equal(result.error_count, 15, 'it stops after 15 refusals in a row');
  assert.ok(warnings.some((args) => args.some((arg) => arg instanceof Error && arg.code === 50013)), 'the error itself is logged, so the triage can classify it');
  assert.ok(warnings.length <= 6, 'only the first failures are logged one by one');

  // A role that is above the bot, or gone, fails before touching anybody.
  result = await run([member('10')], {}, { roleAbove: true });
  assert.deepEqual([result.status, result.error_code], ['failed', 'role_above_bot']);

  // Cancelled from outside: it stops and stays cancelled.
  jobs.clear();
  const cancellable = Array.from({ length: 40 }, (_, index) => member(String(200 + index)));
  const job = baseJob();
  jobs.set(1, { ...job });
  cancellable[15].roles.add = async () => { jobs.get(1).status = 'cancelled'; };
  await processBulkRoleJob(clientOf(makeGuild(cancellable)), { ...job });
  assert.equal(jobs.get(1).status, 'cancelled');
  assert.ok(jobs.get(1).processed_members < 40, 'it stops soon after the cancel');

  // ---- the commands --------------------------------------------------------------------------------------------------------
  const role = require('../src/commands/moderation/role.js');
  const json = role.data.toJSON();
  const names = json.options.map((option) => option.name);
  for (const name of ['add', 'remove', 'create', 'delete', 'edit', 'color', 'icon', 'mentionable', 'hoist', 'bots', 'bots-remove', 'topcolor', 'list', 'members', 'bulk-by-role', 'humans', 'all', 'cancel', 'temp', 'temp-list', 'group']) assert.ok(names.includes(name), `/role ${name} is still there`);
  for (const name of ['job', 'join', 'sticky']) assert.ok(names.includes(name), `/role ${name} is new`);
  assert.ok(json.options.length <= 25, 'Discord allows 25 subcommands and groups');
  const optionsOf = (name) => json.options.find((option) => option.name === name).options.map((option) => option.name);
  assert.deepEqual(optionsOf('all'), ['role', 'remove', 'preview', 'joined_after', 'joined_before', 'min_roles', 'max_roles', 'reason'], 'the old options come first, in the same order');
  assert.deepEqual(optionsOf('bulk-by-role'), ['filter_role', 'target_role', 'remove', 'without', 'preview', 'joined_after', 'joined_before', 'min_roles', 'max_roles', 'reason']);
  assert.deepEqual(optionsOf('humans').slice(0, 2), ['role', 'remove']);
  assert.deepEqual(optionsOf('join'), ['add', 'remove', 'list', 'clear', 'apply'], '/role join holds the join roles');
  assert.deepEqual(optionsOf('sticky'), ['enable', 'disable', 'status']);
  assert.deepEqual(json.options.find((option) => option.name === 'job').options[0].choices.map((choice) => choice.value), ['status', 'pause', 'resume', 'cancel']);
  assert.ok(!require('../src/commands/welcome/greet.js').data.toJSON().options.some((option) => ['joinrole', 'stickyroles'].includes(option.name)), '/greet does not hold them any more');
  const joinrole = require('../src/commands/welcome/joinrole.js');
  assert.deepEqual(joinrole.data.toJSON().options.map((option) => option.name), ['add', 'remove', 'list', 'clear', 'apply']);
  assert.ok(joinrole.data.toJSON().options[0].options.some((option) => option.name === 'after_rules'));
  const { slashJson } = require('../src/utils/slashJson');
  assert.ok(slashJson(role).options.length <= 25);

  // The old words keep working with the prefix: `!role join add` is `!joinrole add`, and so on from `!greet`.
  assert.deepEqual(role.prefixWords.join, { command: 'joinrole', args: [] });
  assert.deepEqual(role.prefixWords.sticky, { command: 'stickyroles', args: [] });
  const greet = require('../src/commands/welcome/greet.js');
  assert.deepEqual(greet.prefixWords.joinrole, { command: 'joinrole', args: [] }, '!greet joinrole still goes to !joinrole');
  assert.equal(greet.prefixWords.jr?.command, 'joinrole', 'and so does its alias');
  assert.equal(greet.prefixWords.stickyroles.command, 'stickyroles');
  const commandRules = require('../src/utils/commandRules');
  assert.deepEqual(commandRules.ruleNames(role, { subcommand: 'add', group: 'join' }), ['joinrole', 'role'], 'a rule for joinrole also reaches /role join');
  assert.deepEqual(commandRules.ruleNames(role, { subcommand: 'enable', group: 'sticky' }), ['stickyroles', 'role']);
  assert.deepEqual(commandRules.ruleNames(role, { subcommand: 'all' }), ['role'], 'the other subcommands answer to role');
  assert.deepEqual(commandRules.permissionNames(role, { subcommand: 'add', group: 'join' }), ['role', 'joinrole']);
  assert.deepEqual(commandRules.ruleNames(role, { subcommand: 'create', group: 'group' }), ['role']);

  // How the prefix reads the options.
  const roles = new Collection([['111111111111111111', { id: '111111111111111111', name: 'Member' }], ['222222222222222222', { id: '222222222222222222', name: 'Old' }]]);
  const message = { guild: { id: '999', channels: { cache: new Collection() }, roles: { cache: roles }, members: { cache: new Collection() } }, author: { id: '2' }, member: { id: '2' }, channel: { id: '3' }, client: {}, content: '' };
  const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
  let read = await buildInteractionFromMessage(message, role, 'all <@&111111111111111111> remove preview cleaning up the server');
  assert.equal(read.options.getSubcommand(), 'all');
  assert.equal(read.options.getBoolean('remove'), true, 'the word remove is the option');
  assert.equal(read.options.getBoolean('preview'), true);
  assert.equal(read.options.getString('reason'), 'cleaning up the server', 'the rest is the reason, not a date');
  assert.equal(read.options.getString('joined_after'), null);
  read = await buildInteractionFromMessage(message, role, 'all <@&111111111111111111> --joined_after 30d --max_roles 0 --preview');
  assert.deepEqual([read.options.getString('joined_after'), read.options.getInteger('max_roles'), read.options.getBoolean('preview'), read.options.getBoolean('remove')], ['30d', 0, true, null]);
  read = await buildInteractionFromMessage(message, role, 'has <@&222222222222222222> <@&111111111111111111> without');
  assert.deepEqual([read.options.getRole('filter_role').id, read.options.getRole('target_role').id, read.options.getBoolean('without')], ['222222222222222222', '111111111111111111', true]);
  read = await buildInteractionFromMessage(message, role, 'humans <@&111111111111111111> true');
  assert.equal(read.options.getBoolean('remove'), true, 'the old way (a true) still works');
  read = await buildInteractionFromMessage(message, role, 'job pause');
  assert.deepEqual([read.options.getSubcommand(), read.options.getString('action')], ['job', 'pause']);
  read = await buildInteractionFromMessage(message, role, 'status');
  assert.equal(read.options.getSubcommand(), 'job', '!role status is !role job');
  read = await buildInteractionFromMessage(message, joinrole, 'add <@&111111111111111111> humans after_rules');
  assert.deepEqual([read.options.getString('target'), read.options.getBoolean('after_rules')], ['humans', true]);

  // ---- join roles that wait for the rules ---------------------------------------------------------------------------------
  const given = [];
  const joinMember = (pending, { bot = false, roles: held = [] } = {}) => {
    const cache = new Collection(held.map((id) => [id, { id }]));
    return {
      id: '77', pending, user: { bot }, joinedTimestamp: Date.now(), flags: { bitfield: 0 }, client: {},
      roles: { cache, add: async (ids) => { given.push([].concat(ids)); } },
      guild: {
        id: '999', members: { me: { permissions: { has: () => true }, roles: { highest: { position: 10 } } } },
        roles: { cache: new Collection([['501', { id: '501', position: 2 }], ['502', { id: '502', position: 2 }], ['503', { id: '503', position: 20 }]]) },
        available: true,
      },
    };
  };
  joinRows.length = 0;
  joinRows.push({ role_id: '501', target: 'all', after_rules: false }, { role_id: '502', target: 'humans', after_rules: true }, { role_id: '503', target: 'all', after_rules: false });
  const onJoin = require('../src/events/guildMemberAddJoinRole.js');
  await onJoin.execute(joinMember(true));
  assert.deepEqual(given.splice(0), [['501']], 'a pending member only gets the roles that do not wait; the one above Petto is left out');
  await onJoin.execute(joinMember(false));
  assert.deepEqual(given.splice(0), [['501', '502']], 'a member with nothing to accept gets them all');
  const onAccept = require('../src/events/guildMemberUpdateJoinRoles.js');
  await onAccept.execute({ pending: true }, joinMember(false));
  assert.deepEqual(given.splice(0), [['502']], 'when they accept the rules the waiting role is given');
  await onAccept.execute({ pending: false }, joinMember(false));
  await onAccept.execute({ pending: true }, joinMember(true));
  assert.deepEqual(given, [], 'nothing happens for an update that is not the acceptance');
  await onAccept.execute({ pending: null }, joinMember(false, { roles: ['999'] }));
  assert.deepEqual(given.splice(0), [['502']], 'a member whose old copy is not known, who is new and has no roles, counts');
  await onAccept.execute({ pending: null }, joinMember(false, { roles: ['999', '1', '2'] }));
  assert.deepEqual(given, [], 'but not one who already has roles');

  // ---- temporary roles that are taken away by hand --------------------------------------------------------------------------
  const onUpdate = require('../src/events/guildMemberUpdateTempRoles.js');
  const copy = (ids) => ({ id: '77', partial: false, guild: { id: '999' }, roles: { cache: new Collection(ids.map((id) => [id, { id }])) } });
  temp.length = 0;
  await onUpdate.execute(copy(['999', '500', '501']), copy(['999', '501']));
  assert.deepEqual(temp, [['999', '77', '500']], 'the role that was taken away is forgotten by the expiry');
  temp.length = 0;
  await onUpdate.execute(copy(['999', '500']), copy(['999', '500', '501']));
  await onUpdate.execute({ ...copy(['999', '500']), partial: true }, copy(['999']));
  assert.deepEqual(temp, [], 'nothing is asked for an update that removes no role, or when the old copy is not known');

  // ---- schema, strings and wiring --------------------------------------------------------------------------------------------
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  for (const column of ['dry_run', 'reason', 'min_roles', 'max_roles', 'skip_pending', 'skipped_count', 'cursor_id', 'started_at', 'paused', 'error_code', 'source', 'progress_channel_id', 'progress_message_id']) {
    assert.match(schema, new RegExp(`alter table bulk_role_jobs add column if not exists ${column} `), `bulk_role_jobs.${column} is added without touching what exists`);
  }
  assert.match(schema, /alter table join_roles add column if not exists after_rules boolean not null default false/);
  const { CATALOGS } = require('../src/i18n');
  const { t } = require('../src/i18n');
  for (const lang of ['en', 'es', 'pt-BR']) {
    for (const code of Object.keys(plan.ERROR_CODES)) assert.notEqual(t(lang, `moderation.bulkRole.card.error.${code}`, { text: '' }), `moderation.bulkRole.card.error.${code}`, `${code} is told in ${lang}`);
    for (const key of ['moderation.role.job.none', 'moderation.role.job.pause', 'moderation.role.temp.hadIt', 'welcome.joinRole.list.problem.gone', 'welcome.joinRole.waitsRules', 'moderation.bulkRole.card.hint']) assert.ok(CATALOGS[lang][key], `${key} is in ${lang}`);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'short-aliases.json'), 'utf8')).rja, 'role join apply');
  console.log('Checked the roles upgrade: bulk jobs (filters, preview, resume, refusals, cancel), /role options, /role join and /role sticky, the prefix and the join roles that wait for the rules.');
})().catch((error) => { console.error(error); process.exit(1); });
