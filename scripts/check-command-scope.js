// Where and for whom a custom command works (src/utils/commandScope.js): the channels and roles it is allowed in or blocked from, NSFW, and "restricted" (the answer
// to a member who is not a moderator goes to another channel). It is read from the options of the command, together with the old lists of the commands in code, and
// what the commands page of the dashboard writes survives what the editor of code saves. No database and no Discord: they are replaced.
const assert = require('node:assert/strict');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stub('src/config.js', { ownerId: 'owner', developerIds: ['dev'], codeCommandsDisabled: false });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/handlers/prefixInteraction.js', { tokenize: (text) => String(text).match(/"[^"]*"|\S+/g) ?? [] });
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/premium.js', { PREMIUM_LIMITS: { customCommands: 100 }, getGuildPremium: async () => ({ active: false }), getGuildLimits: () => ({ customCommands: 50 }) });
stub('src/db/embedTemplates.js', { getTemplate: async () => null });
const saved = new Map();
stub('src/db/customCommands.js', {
  normalizeName: (name) => name.toLowerCase().trim().replace(/\s+/g, ''),
  getCommand: async (guildId, name) => saved.get(`${guildId}:${name}`) ?? null,
  setOptions: async (guildId, name, options) => { saved.get(`${guildId}:${name}`).options = options; return true; },
});
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/db/commandData.js', { forGuild: () => ({}) });
stub('src/utils/emojis.js', { EMOJI: {} });
stub('src/utils/colors.js', { COLORS: { DEFAULT: 1 }, semanticColor: () => null, colorFromText: () => null });

const scope = require('../src/utils/commandScope');
const codeCommands = require('../src/utils/codeCommands');

const A = '100000000000000001'; const B = '100000000000000002'; const C = '100000000000000003';
const R1 = '200000000000000001'; const R2 = '200000000000000002';
const member = (roles = [], permissions = []) => ({ roles: { cache: { has: (id) => roles.includes(id) } }, permissions: { has: (flag) => permissions.includes(flag) } });
const channel = (id, extra = {}) => ({ id, parentId: null, nsfw: false, ...extra });

// Nothing saved: everywhere, for everybody.
for (const raw of [null, undefined, {}, [], 'x']) assert.ok(scope.allows(raw, member(), channel(A)));
// Allowed channels: only there. Blocked channels: everywhere else. Blocked wins when both name the same channel.
assert.ok(scope.allows({ allowChannels: [A] }, member(), channel(A)));
assert.ok(!scope.allows({ allowChannels: [A] }, member(), channel(B)));
assert.ok(!scope.allows({ blockChannels: [A] }, member(), channel(A)));
assert.ok(scope.allows({ blockChannels: [A] }, member(), channel(B)));
assert.ok(!scope.allows({ allowChannels: [A], blockChannels: [A] }, member(), channel(A)));
assert.ok(scope.allows({ allowChannels: [A, B], blockChannels: [C] }, member(), channel(B)));
// A thread counts as the channel it is in.
assert.ok(scope.allows({ allowChannels: [A] }, member(), channel('300000000000000009', { parentId: A })));
assert.ok(!scope.allows({ blockChannels: [A] }, member(), channel('300000000000000009', { parentId: A })));
// Allowed roles: one of them. Blocked roles: none of them. Blocked wins.
assert.ok(scope.allows({ allowRoles: [R1] }, member([R1]), channel(A)));
assert.ok(!scope.allows({ allowRoles: [R1] }, member([R2]), channel(A)));
assert.ok(!scope.allows({ blockRoles: [R1] }, member([R1]), channel(A)));
assert.ok(scope.allows({ blockRoles: [R1] }, member([R2]), channel(A)));
assert.ok(!scope.allows({ allowRoles: [R1], blockRoles: [R2] }, member([R1, R2]), channel(A)));
// NSFW: only in a channel marked NSFW (or a thread of one).
assert.ok(!scope.allows({ nsfw: true }, member(), channel(A)));
assert.ok(scope.allows({ nsfw: true }, member(), channel(A, { nsfw: true })));
assert.ok(scope.allows({ nsfw: true }, member(), channel('300000000000000009', { parent: { nsfw: true } })));
// Ids that are not ids are never kept, and the lists have a limit.
assert.deepEqual(scope.scopeOf({ allowChannels: ['x', A, A, '12'] }).allowChannels, [A]);
assert.equal(scope.scopeOf({ allowRoles: Array.from({ length: 40 }, (_, i) => String(200000000000000100n + BigInt(i))) }).allowRoles.length, scope.MAX_IDS);

// The old lists of the commands in code count as the same: `require`/`only` allow, `ignore` blocks.
const legacy = { roles: { mode: 'require', ids: [R1] }, channels: { mode: 'ignore', ids: [A] } };
assert.deepEqual(scope.scopeOf(legacy).allowRoles, [R1]);
assert.deepEqual(scope.scopeOf(legacy).blockChannels, [A]);
assert.ok(!scope.allows(legacy, member([R1]), channel(A)) && scope.allows(legacy, member([R1]), channel(B)) && !scope.allows(legacy, member([R2]), channel(B)));
assert.ok(codeCommands.allowedHere({ options: legacy }, member([R1]), channel(B)), 'the code commands use the same rule');
assert.ok(!codeCommands.allowedHere({ options: { blockChannels: [A] } }, member(), channel(A)), 'and the new lists');
// Only the new fields are what the commands page writes: the old ones are not copied into them.
assert.deepEqual(scope.scopeFields(legacy).allowRoles, []);
assert.equal(codeCommands.optionsOf({ options: { allowChannels: [A], nsfw: true, restricted: true, restrictedChannel: B } }).restrictedChannel, B);

// Moderators, and where a restricted command answers.
assert.ok(scope.isModerator(member([], [PermissionFlagsBits.ManageMessages])) && scope.isModerator(member([], [PermissionFlagsBits.Administrator])));
assert.ok(!scope.isModerator(member()) && !scope.isModerator({}) && !scope.isModerator(null));
const target = { id: B, isTextBased: () => true, isDMBased: () => false, permissionsFor: () => ({ has: () => true }) };
const guild = { channels: { cache: new Map([[B, target]]) }, members: { me: {} } };
const restricted = { restricted: true, restrictedChannel: B };
assert.equal(scope.redirectChannel(restricted, member(), guild), target);
assert.equal(scope.redirectChannel(restricted, member([], [PermissionFlagsBits.ManageMessages]), guild), null, 'a moderator is answered where they asked');
assert.equal(scope.redirectChannel({ restricted: true }, member(), guild), null, 'restricted with no channel is answered where it was asked');
assert.equal(scope.redirectChannel({ restrictedChannel: B }, member(), guild), null, 'not restricted');
assert.equal(scope.redirectChannel(restricted, member(), { channels: { cache: new Map() }, members: { me: {} } }), null, 'a channel that is gone');
const mute = { ...target, permissionsFor: () => ({ has: () => false }) };
assert.equal(scope.redirectChannel(restricted, member(), { channels: { cache: new Map([[B, mute]]) }, members: { me: {} } }), null, 'a channel Petto cannot write in');

// What the commands page wrote about where a command works survives what the editor of code saves.
(async () => {
  const admin = require('../src/utils/codeCommandAdmin');
  const channelsOfGuild = new Map([[A, { id: A, isTextBased: () => true, isDMBased: () => false }]]);
  const rolesOfGuild = new Map([[R1, {}]]);
  const theGuild = { id: '900000000000000001', roles: { cache: rolesOfGuild }, channels: { cache: channelsOfGuild } };
  saved.set(`${theGuild.id}:hello`, { name: 'hello', options: { allowChannels: [A], blockRoles: [R2], nsfw: true, restricted: true, restrictedChannel: B } });
  const result = await admin.setCommandOptions({ guild: theGuild, name: 'hello', options: { errorsAsResponse: false, roles: { mode: 'require', ids: [R1] }, channels: { mode: 'only', ids: [] } }, lang: 'en' });
  assert.ok(result.ok, 'the editor of code saves its part');
  const after = saved.get(`${theGuild.id}:hello`).options;
  assert.deepEqual([after.allowChannels, after.blockRoles, after.nsfw, after.restricted, after.restrictedChannel], [[A], [R2], true, true, B], 'the lists of the commands page are kept');
  assert.equal(after.errorsAsResponse, false);
  saved.set(`${theGuild.id}:plain`, { name: 'plain', options: { errorsAsResponse: true } });
  await admin.setCommandOptions({ guild: theGuild, name: 'plain', options: {}, lang: 'en' });
  assert.deepEqual(Object.keys(saved.get(`${theGuild.id}:plain`).options).sort(), ['channels', 'errorChannel', 'errorsAsResponse', 'roles'], 'a command that was never limited keeps options without the new fields');
  assert.deepEqual(after.roles.ids, [R1]);
  console.log('custom command scope checks passed'); // i18n-ignore: output of a check
})().catch((error) => { console.error(error); process.exit(1); });
