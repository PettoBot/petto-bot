// Checks what Petto does when a role that a server chose in a setting was deleted (Discord answers "Unknown Role", code 10011):
//   - the roles that still exist are given, the dead one is left out (a group that was refused is split);
//   - verification: the verified role is made again when Petto may, else the member still counts as verified and is told kindly, never
//     "contact a moderator"; the staff is told in its log channel once a day; no priority error;
//   - join roles, reaction roles, role buttons, level rewards, invite rewards: the rest is still given, the staff is told once a day, and the
//     dead role is taken out of the setting only when the staff could be told.
// The database, Discord and the log channel are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

const ROOT = path.join(__dirname, '..');
function stub(relative, exports) {
  const resolved = require.resolve(path.join(ROOT, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const warnings = [];
const errors = [];
stub('src/utils/logger.js', { info() {}, warn: (...args) => warnings.push(args.map(String).join(' ')), error: (...args) => errors.push(args) });
stub('src/db/guilds.js', { ensureGuild: async () => {}, findGuildLanguage: async () => null });

// The settings of the verification, the log channel of the server and what was posted in it.
let stored = {};
const saved = [];
stub('src/db/verificationConfig.js', {
  getConfig: async () => ({ ...stored }),
  upsertConfig: async (_id, patch) => { saved.push(patch); stored = { ...stored, ...patch }; return { ...stored }; },
});
let hasLog = true;
stub('src/db/logConfig.js', {
  getLogConfig: async () => (hasLog
    ? { entries: [{ event: 'verification', channel_id: 'c1' }, { event: 'roles', channel_id: 'c1' }], webhooks: [{ channel_id: 'c1', webhook_id: 'w', webhook_token: 't' }], ignored: [] }
    : { entries: [], webhooks: [], ignored: [] }),
});
const notes = [];
stub('src/logging/engine.js', { sendLog: async (_client, guildId, event, embed) => { notes.push({ guildId, event, embed }); }, getAvatar: () => null });
const claims = new Set();
let released = 0;
stub('src/db/verificationRedemptions.js', {
  claimRedemption: async ({ jti }) => { if (claims.has(jti)) return false; claims.add(jti); return true; },
  releaseRedemption: async (jti) => { released += 1; claims.delete(jti); },
  hasEverVerified: async () => false,
});
const logged = [];
const dms = [];
stub('src/utils/verificationLog.js', { logVerification: async (_client, _guild, user) => { logged.push(user.id); } });
stub('src/utils/verifyMessage.js', { sendVerifiedDM: async (member) => { dms.push(member.id); }, sendVerifyDM: async () => {} });

const triage = require('../src/utils/errorTriage');
const deadRoles = require('../src/utils/deadRoles');
const { applyVerification, applyVerificationRoles } = require('../src/utils/verifyApply');
const { giveVerifiedRole } = require('../src/utils/verifyHeal');

const GUILD = '111111111111111111';
const unknownRole = () => Object.assign(new Error('Unknown Role'), { name: 'DiscordAPIError', code: 10011, status: 404, method: 'PUT' });
const noPermission = () => Object.assign(new Error('Missing Permissions'), { name: 'DiscordAPIError', code: 50013, status: 403, method: 'PUT' });

/** A server with the roles it has now (`ids`), the permissions of Petto and a role manager that can make roles. */
function makeGuild({ ids = [], manage = true, size = null } = {}) {
  const cache = new Map(ids.map((id) => [id, { id, name: id, position: 1, managed: false }]));
  const created = [];
  const guild = {
    id: GUILD, available: true, client: { user: { id: 'bot' } },
    members: { me: { permissions: { has: (flag) => manage && flag === PermissionFlagsBits.ManageRoles }, roles: { highest: { position: 10 } } } },
    roles: {
      cache,
      create: async ({ name }) => {
        const role = { id: `new-${created.length + 1}`, name, position: 1, managed: false };
        created.push(role);
        cache.set(role.id, role);
        return role;
      },
    },
    created,
  };
  if (size) Object.defineProperty(cache, 'size', { get: () => size });
  return guild;
}

/** A member whose role manager refuses the ids in `dead` the way Discord does: a list with a dead role is refused as a whole. */
function makeMember(id, { has = [], dead = [], other = null } = {}) {
  const calls = [];
  const cache = new Map(has.map((roleId) => [roleId, { id: roleId }]));
  return {
    id, user: { id }, client: { user: { id: 'bot' } }, calls,
    roles: {
      cache,
      add: async (what, reason) => {
        const list = Array.isArray(what) ? what : [what];
        calls.push(['add', Array.isArray(what) ? list : what, reason]);
        if (other && list.some((roleId) => other.includes(roleId))) throw noPermission();
        if (list.some((roleId) => dead.includes(roleId))) throw unknownRole();
        for (const roleId of list) cache.set(roleId, { id: roleId });
      },
      remove: async (what) => { calls.push(['remove', what]); for (const roleId of [].concat(what)) cache.delete(roleId); },
    },
  };
}
const given = (member) => [...member.roles.cache.keys()];
const reset = () => { notes.length = 0; saved.length = 0; deadRoles.resetNotes(); hasLog = true; };

(async () => {
  // The error is a setting of the server, never a priority error (the table of the team).
  const triaged = triage.classify(unknownRole(), { args: ['Failed to apply verification roles (letters in Discord):', unknownRole()] });
  assert.deepEqual([triaged.priority, triaged.benign, triaged.kind, triaged.fix], [false, true, 'unknown-role', 'config-role-missing']);
  assert.ok(deadRoles.isUnknownRole(unknownRole()) && !deadRoles.isUnknownRole(noPermission()) && !deadRoles.isUnknownRole(null));

  // ----------------------------------------------------------------------------------------------------------------------------------------
  // `addRoles`: the rest is given when one role is gone.
  let member = makeMember('u1', { dead: ['dead'] });
  let result = await deadRoles.addRoles(member, ['a', 'dead', 'b'], 'why');
  assert.deepEqual([result.added, result.dead, result.failed], [['a', 'b'], ['dead'], []], 'the others are given, the dead one is named');
  assert.deepEqual(given(member), ['a', 'b']);
  assert.deepEqual(member.calls[0][1], ['a', 'dead', 'b'], 'the list goes first, as a list');
  member = makeMember('u2');
  result = await deadRoles.addRoles(member, ['a', 'b'], 'why');
  assert.deepEqual([result.added, member.calls.length], [['a', 'b'], 1], 'no dead role: one call, as before');
  member = makeMember('u3', { dead: ['dead'] });
  result = await deadRoles.addRoles(member, 'dead', 'why');
  assert.deepEqual([result.added, result.dead, member.calls[0][1]], [[], ['dead'], 'dead'], 'one role is given as one role (a PUT)');
  member = makeMember('u4', { other: ['a', 'b'] });
  result = await deadRoles.addRoles(member, ['a', 'b'], 'why');
  assert.equal(result.error.code, 50013, 'a refusal that is not about a deleted role is the same error as before');
  assert.deepEqual([result.added, result.failed, member.calls.length], [[], ['a', 'b'], 1], 'and the group is not tried one by one');
  member = makeMember('u5', { dead: ['dead'] });
  result = await deadRoles.addRoles(member, [{ id: 'a' }, { id: 'dead' }], 'why');
  assert.deepEqual(result.added, ['a'], 'roles work as well as ids');

  // ----------------------------------------------------------------------------------------------------------------------------------------
  // The staff note: once a day for each role, in the log channel, and only when there is one.
  reset();
  const guild = makeGuild({ ids: ['x'] });
  let now = 1_000_000;
  assert.equal(await deadRoles.tellStaff({ guild, kind: 'join', roleId: '900000000000000001', outcome: 'pick', now }), true, 'the first time it is sent');
  assert.equal(await deadRoles.tellStaff({ guild, kind: 'join', roleId: '900000000000000001', outcome: 'pick', now: now + 3_600_000 }), false, 'an hour later it is not repeated');
  assert.equal(await deadRoles.tellStaff({ guild, kind: 'join', roleId: '900000000000000002', outcome: 'pick', now: now + 3_600_000 }), true, 'another role is another note');
  assert.equal(await deadRoles.tellStaff({ guild, kind: 'join', roleId: '900000000000000001', outcome: 'pick', now: now + deadRoles.DAY_MS + 1 }), true, 'the next day it is said again');
  assert.equal(notes.length, 3);
  assert.deepEqual([notes[0].event, notes[0].guildId], ['roles', GUILD], 'join roles go to the roles log of the server');
  assert.ok(notes[0].embed.description.includes('900000000000000001') && notes[0].embed.description.includes('the join roles'), 'it says which role and where it was chosen');
  reset();
  hasLog = false;
  assert.equal(await deadRoles.tellStaff({ guild, kind: 'join', roleId: '900000000000000001', outcome: 'pick' }), false, 'no log channel: nobody to tell');
  assert.equal(notes.length, 0);
  // Nothing is taken out of a setting without a note.
  const dropped = [];
  assert.deepEqual(await deadRoles.reportDeadRoles({ client: guild.client, guild, kind: 'join', roleIds: ['900000000000000001'], forget: async (id) => { dropped.push(id); } }), [], 'no log channel: nothing is deleted');
  assert.deepEqual(dropped, []);
  hasLog = true;
  assert.deepEqual(await deadRoles.reportDeadRoles({ client: guild.client, guild, kind: 'join', roleIds: ['900000000000000001'], forget: async (id) => { dropped.push(id); } }), ['900000000000000001'], 'with a log channel: taken out');
  assert.deepEqual(dropped, ['900000000000000001']);
  assert.match(notes.at(-1).embed.description, /took it out of that setting/, 'and the note says so');
  // The same role reported again and again (a member joins, another levels up) is one note a day.
  const before = notes.length;
  for (let i = 0; i < 5; i += 1) await deadRoles.reportDeadRoles({ client: guild.client, guild, kind: 'level', roleIds: ['900000000000000003'] });
  assert.equal(notes.length, before + 1, 'five reports, one note');
  const quiet = triage.classify(unknownRole(), { args: [unknownRole()] });
  assert.equal(quiet.priority, false);

  // ----------------------------------------------------------------------------------------------------------------------------------------
  // Verification, the verified role was deleted and can be made again.
  reset();
  stored = { enabled: true, unverified_role_id: 'gate', verified_role_id: 'dead-verified' };
  let vguild = makeGuild({ ids: ['gate'] });
  let first = makeMember('m1', { has: ['gate'], dead: ['dead-verified'] });
  let outcome = await applyVerification({ client: vguild.client, guild: vguild, member: first, settings: { ...stored }, jti: 'jti-1' });
  assert.deepEqual([outcome.ok, outcome.noRole], [true, false], 'verified, with a role');
  assert.equal(vguild.created.length, 1, 'a new role was made');
  assert.equal(vguild.created[0].name, 'Verified', 'with the name of the verification setup');
  assert.deepEqual(saved, [{ verified_role_id: 'new-1' }], 'and saved in the verification settings');
  assert.deepEqual(given(first), ['new-1'], 'the gate role came off and the new role is on');
  assert.ok(first.calls.some(([kind, what]) => kind === 'remove' && what === 'gate'), 'the gate role was taken off');
  assert.equal(notes.length, 1, 'the staff is told once');
  assert.equal(notes[0].event, 'verification', 'in the verification log');
  assert.match(notes[0].embed.description, /dead-verified.*chosen for verification was deleted.*created a new role called \*\*Verified\*\*/, 'what happened and what Petto did');
  assert.deepEqual([logged, dms], [['m1'], ['m1']], 'logged and thanked as always');
  assert.equal(released, 0);
  // The next member, with settings read before the new role existed: the same new role, not a second one, and no second note.
  const second = makeMember('m2', { has: ['gate'], dead: ['dead-verified'] });
  outcome = await applyVerification({ client: vguild.client, guild: vguild, member: second, settings: { unverified_role_id: 'gate', verified_role_id: 'dead-verified' }, jti: 'jti-2' });
  assert.deepEqual([outcome.ok, outcome.noRole, vguild.created.length, given(second)], [true, false, 1, ['new-1']], 'the new role is shared, not made again');
  assert.equal(notes.length, 1, 'and the staff is not told again');
  // Two members at the same moment make one role.
  reset();
  stored = { enabled: true, unverified_role_id: 'gate', verified_role_id: 'dead-verified' };
  vguild = makeGuild({ ids: ['gate'] });
  const together = await Promise.all([1, 2, 3].map((n) => applyVerification({ client: vguild.client, guild: vguild, member: makeMember(`t${n}`, { has: ['gate'], dead: ['dead-verified'] }), settings: { unverified_role_id: 'gate', verified_role_id: 'dead-verified' }, jti: `jti-t${n}` })));
  assert.ok(together.every((entry) => entry.ok && !entry.noRole));
  assert.equal(vguild.created.length, 1, 'three members, one new role');

  // ----------------------------------------------------------------------------------------------------------------------------------------
  // Verification, the role cannot be made (Petto cannot manage roles): the member is verified, not blocked.
  reset();
  claims.clear(); logged.length = 0; dms.length = 0; released = 0;
  stored = { enabled: true, unverified_role_id: 'gate', verified_role_id: 'dead-verified' };
  vguild = makeGuild({ ids: ['gate'], manage: false });
  const stuck = makeMember('s1', { has: ['gate'], dead: ['dead-verified'] });
  outcome = await applyVerification({ client: vguild.client, guild: vguild, member: stuck, settings: { ...stored }, jti: 'jti-s1' });
  assert.deepEqual([outcome.ok, outcome.noRole], [true, true], 'the captcha was solved: verified, with no role to show for it');
  assert.equal(vguild.created.length, 0, 'no role was made without the permission');
  assert.ok(claims.has('jti-s1') && released === 0, 'the single-use claim stays: it is the record that they verified');
  assert.ok(stuck.calls.some(([kind, what]) => kind === 'remove' && what === 'gate'), 'the gate role still came off');
  assert.deepEqual(logged, ['s1'], 'it is in the verification log');
  assert.deepEqual(dms, [], '"you have full access" is not said when there was no role');
  assert.equal(notes.length, 1, 'the staff is told');
  assert.match(notes[0].embed.description, /dead-verified/, 'which role');
  assert.match(notes[0].embed.description, /cleared it from the verification settings.*verification settings in the dashboard \(or run `\/verify setup`\) and pick a role again/, 'what Petto did and what to do');
  assert.deepEqual(saved, [{ verified_role_id: null }], 'the dead id is taken out of the settings (the staff was told)');
  // The next members: no new attempt at the dead role, no new note, verified all the same.
  const next = makeMember('s2', { has: ['gate'] });
  outcome = await applyVerification({ client: vguild.client, guild: vguild, member: next, settings: { ...stored }, jti: 'jti-s2' });
  assert.deepEqual([outcome.ok, outcome.noRole, notes.length], [true, false, 1], 'nothing to give is a valid setup: no repeated note');
  assert.ok(!next.calls.some(([kind, what]) => kind === 'add' && what === 'dead-verified'), 'the dead role is not tried again');
  // The server is full of roles: the same.
  reset();
  stored = { enabled: true, verified_role_id: 'dead-verified' };
  vguild = makeGuild({ ids: [], size: 250 });
  outcome = await applyVerification({ client: vguild.client, guild: vguild, member: makeMember('f1', { dead: ['dead-verified'] }), settings: { ...stored }, jti: 'jti-f1' });
  assert.deepEqual([outcome.ok, outcome.noRole, vguild.created.length], [true, true, 0], 'no room for a new role: verified, nothing made');
  // No log channel: the member is verified, the setting is kept (nothing is deleted without a note), and there is no note to send.
  reset();
  hasLog = false;
  stored = { enabled: true, verified_role_id: 'dead-verified' };
  vguild = makeGuild({ ids: [], manage: false });
  outcome = await applyVerification({ client: vguild.client, guild: vguild, member: makeMember('n1', { dead: ['dead-verified'] }), settings: { ...stored }, jti: 'jti-n1' });
  assert.deepEqual([outcome.ok, outcome.noRole, saved.length, notes.length], [true, true, 0, 0], 'no log channel: the setting is kept');

  // Every other failure is still a failure: the claim is given back and the member is asked to contact a moderator (the caller says it).
  reset();
  claims.clear(); released = 0;
  stored = { enabled: true, verified_role_id: 'role-ok' };
  vguild = makeGuild({ ids: ['role-ok'] });
  await assert.rejects(() => applyVerification({ client: vguild.client, guild: vguild, member: makeMember('p1', { other: ['role-ok'] }), settings: { ...stored }, jti: 'jti-p1' }), (error) => error.code === 50013);
  assert.equal(released, 1, 'the claim is given back, so they can try again');
  // The other roles still go on: a dead gate role does not stop the verified one; no verified role at all is a valid setup.
  const gateGone = makeMember('g1', { has: ['gate'] });
  gateGone.roles.remove = async () => { throw unknownRole(); };
  assert.deepEqual(await applyVerificationRoles({ client: vguild.client, guild: vguild, member: gateGone, settings: { unverified_role_id: 'gate', verified_role_id: 'role-ok' }, lang: 'en' }), { noRole: false });
  assert.deepEqual(given(gateGone).sort(), ['gate', 'role-ok'], 'the verified role was given although the gate role could not be taken off');
  assert.deepEqual(await applyVerificationRoles({ client: vguild.client, guild: vguild, member: makeMember('g2'), settings: { enabled: true }, lang: 'en' }), { noRole: false });
  // A returning member gets it back the same way.
  reset();
  stored = { enabled: true, verified_role_id: 'dead-verified' };
  vguild = makeGuild({ ids: [] });
  const returning = makeMember('r1', { dead: ['dead-verified'] });
  assert.deepEqual(await giveVerifiedRole({ client: vguild.client, guild: vguild, member: returning, settings: { ...stored }, lang: 'en', reason: 'returning' }), { given: true, healed: true, dead: false });
  assert.deepEqual(given(returning), ['new-1']);

  // No priority error is ever raised by any of this.
  assert.equal(errors.length, 0, 'nothing was logged as an error');

  // ----------------------------------------------------------------------------------------------------------------------------------------
  // Join roles: the roles that exist are given, the dead one is taken out of the list, the staff is told once.
  reset();
  const removedJoin = [];
  stub('src/db/joinRoles.js', {
    listRoles: async () => [{ role_id: 'a', target: 'all' }, { role_id: 'dead', target: 'all' }, { role_id: 'b', target: 'all' }],
    removeRole: async (_guildId, roleId) => { removedJoin.push(roleId); return true; },
  });
  delete require.cache[require.resolve('../src/events/guildMemberAddJoinRole.js')];
  const joinHandler = require('../src/events/guildMemberAddJoinRole.js');
  const joinGuild = makeGuild({ ids: ['a', 'b'] });
  const joiner = makeMember('j1');
  joiner.guild = joinGuild;
  joiner.user = { id: 'j1', bot: false };
  await joinHandler.execute(joiner);
  assert.deepEqual(given(joiner), ['a', 'b'], 'the roles that exist are given');
  assert.deepEqual(removedJoin, ['dead'], 'the dead one is taken out of the list');
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].event, /`dead`/.test(notes[0].embed.description), /the join roles/.test(notes[0].embed.description)], ['roles', true, true]);
  // A stale list of roles (the role was deleted a moment ago): the list is refused, split, and the rest is still given.
  reset(); removedJoin.length = 0;
  const staleGuild = makeGuild({ ids: ['a', 'b', 'dead'] });
  const stale = makeMember('j2', { dead: ['dead'] });
  stale.guild = staleGuild; stale.user = { id: 'j2', bot: false };
  await joinHandler.execute(stale);
  assert.deepEqual(given(stale), ['a', 'b'], 'the others are given');
  assert.deepEqual(removedJoin, ['dead'], 'the dead one is taken out');

  // Reaction roles (a reaction and a button).
  reset();
  stub('src/db/reactionRoles.js', { getReactionRole: async () => ({ id: 7, role_id: 'dead', mode: 'add', interaction_type: 'reaction' }), getReactionRoleById: async () => ({ id: 7, guild_id: GUILD, role_id: 'dead', mode: 'add', interaction_type: 'button' }) });
  delete require.cache[require.resolve('../src/events/messageReactionAddRoles.js')];
  const reactionHandler = require('../src/events/messageReactionAddRoles.js');
  const rrGuild = makeGuild({ ids: [] });
  const reactor = makeMember('rr1', { dead: ['dead'] });
  rrGuild.members.fetch = async () => reactor;
  await reactionHandler.execute({ partial: false, emoji: { toString: () => '🎉' }, client: rrGuild.client, message: { id: 'm', guild: rrGuild } }, { id: 'rr1', bot: false });
  assert.deepEqual(given(reactor), [], 'nothing to give');
  assert.equal(notes.length, 1, 'the staff is told');
  assert.match(notes[0].embed.description, /a reaction role/);
  assert.equal(errors.length, 0);
  const buttons = require('../src/interactions/reactionRoleButton.js');
  const buttonReplies = [];
  const buttonMember = makeMember('rr2');
  rrGuild.members.fetch = async () => buttonMember;
  await buttons.handleButton({
    customId: 'rr:7', guild: rrGuild, user: { id: 'rr2' }, client: rrGuild.client, locale: 'en-US', guildId: GUILD,
    reply: async (payload) => { buttonReplies.push(payload); },
  });
  assert.equal(buttonReplies.at(-1).content, 'That role no longer exists.', 'the member is told, as before');
  assert.equal(notes.length, 1, 'one note a day for that role, whoever pressed');

  // Level rewards: the rest is given, the reward of the dead role is taken out of the list.
  reset();
  const removedRewards = [];
  stub('src/db/levelRewards.js', {
    listRewards: async () => [{ level: 1, role_id: 'a' }, { level: 2, role_id: 'dead' }, { level: 3, role_id: 'b' }],
    removeReward: async (_guild, level, source) => { removedRewards.push([level, source]); },
  });
  delete require.cache[require.resolve('../src/utils/levelActions.js')];
  const levelActions = require('../src/utils/levelActions.js');
  const levelGuild = makeGuild({ ids: ['a', 'b'] });
  const climber = makeMember('l1');
  climber.roles.add = async function add(role) { this.cache.set(role.id, role); };
  const gained = await levelActions.checkRewards(levelGuild, climber, 3, { role_mode: 'all' }, 'text');
  assert.deepEqual([...climber.roles.cache.keys()].sort(), ['a', 'b'], 'the rewards that exist are given');
  assert.equal(gained.id, 'b');
  assert.deepEqual(removedRewards, [[2, 'text']], 'the reward of the dead role is taken out');
  assert.equal(notes.length, 1);
  assert.match(notes[0].embed.description, /a level reward/);

  // ----------------------------------------------------------------------------------------------------------------------------------------
  // The places are wired: the web page of the verification uses the same step as Discord, and the error cards name the server.
  const server = fs.readFileSync(path.join(ROOT, 'src/web/server.js'), 'utf8');
  assert.match(server, /applyVerificationRoles\(/, 'the web route gives the roles through the shared step');
  assert.ok(!/member\.roles\.add\(verifyConfig\.verified_role_id/.test(server), 'and not with its own copy');
  assert.match(server, /logger\.error\(\{ guildId: payload\.guildId, userId: payload\.userId/, 'the error of the web route says which server');
  const letters = fs.readFileSync(path.join(ROOT, 'src/interactions/verifyLetters.js'), 'utf8');
  assert.match(letters, /logger\.error\(\{ guildId, userId: interaction\.user\.id/, 'the error of the letters says which server');
  assert.equal(errors.length, 0);
  console.log('check-dead-roles: ok');
})().catch((error) => { console.error(error); process.exit(1); });
