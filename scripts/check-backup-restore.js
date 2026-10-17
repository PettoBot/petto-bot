// The restore of a backup: what it says before it does anything, how it reports progress, that it can be stopped, that it never deletes
// when something failed or when it was stopped, that only one runs at a time, and the human check that opens it.
const assert = require('node:assert/strict');

const stub = (relative, exports) => { const file = require.resolve(relative); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
const config = { verifyTokenSecret: 'a-secret-for-the-check-of-the-restore-pictures' };
stub('../src/config', config);
stub('../src/utils/logger', { warn() {}, info() {}, error() {} });
const { planRestore, restoreBackup, restoreParts, backupContents } = require('../src/utils/backupRestore');
const jobs = require('../src/utils/backupJobs');

function fakeGuild({ failCreate = false } = {}) {
  const channels = new Map();
  const roles = new Map();
  const calls = { deleted: [], created: [] };
  const stickerStore = new Map();
  const ruleStore = new Map();
  const channel = (id, name, type = 0) => ({
    id, name, type, isThread: () => false,
    edit: async () => {}, setPosition: async () => {},
    permissionOverwrites: { set: async () => {} },
    delete: async () => { calls.deleted.push(`channel:${name}`); channels.delete(id); },
  });
  const role = (id, name, managed = false) => ({ id, name, managed, edit: async () => {}, delete: async () => { calls.deleted.push(`role:${name}`); roles.delete(id); } });
  const guild = {
    id: '100000000000000001', name: 'Test server',
    rulesChannelId: null, systemChannelId: null, publicUpdatesChannelId: null, afkChannelId: null,
    roles: { cache: Object.assign(roles, { find: (fn) => [...roles.values()].find(fn) }), create: async (data) => { const made = role(String(900 + roles.size), data.name); roles.set(made.id, made); calls.created.push(`role:${data.name}`); return made; }, setPositions: async () => {} },
    channels: { cache: Object.assign(channels, { find: (fn) => [...channels.values()].find(fn) }), create: async (data) => { if (failCreate) throw new Error('missing permission'); const made = channel(String(800 + channels.size), data.name, data.type); channels.set(made.id, made); calls.created.push(`channel:${data.name}`); return made; } },
    emojis: { cache: Object.assign(new Map(), { find: () => undefined }), create: async () => {} },
    stickers: { cache: Object.assign(new Map(), { find: (fn) => [...stickerStore.values()].find(fn) }), create: async (data) => { stickerStore.set(data.name, { name: data.name }); calls.created.push(`sticker:${data.name}`); } },
    autoModerationRules: { cache: Object.assign(new Map(), { find: (fn) => [...ruleStore.values()].find(fn) }), create: async (data) => { ruleStore.set(data.name, { name: data.name, edit: async () => {} }); calls.created.push(`automod:${data.name}`); } },
    edit: async () => {},
  };
  roles.set(guild.id, role(guild.id, '@everyone'));
  roles.set('r-old', role('r-old', 'old-role'));
  channels.set('c-old', channel('c-old', 'old-channel'));
  channels.set('c-here', channel('c-here', 'where-it-started'));
  return { guild, calls };
}

const snapshot = {
  format: 'petto-server-backup', version: 2,
  guild: { name: 'Test server' },
  roles: [{ id: '100000000000000001', name: '@everyone', position: 0 }, { id: 'r-1', name: 'Mods', position: 1 }, { id: 'r-2', name: 'Members', position: 2 }],
  channels: [{ id: 'c-1', name: 'general', type: 0, position: 0 }, { id: 'c-2', name: 'rules', type: 0, position: 1 }, { id: 'c-3', name: 'voice', type: 2, position: 2 }],
  emojis: [],
  stickers: [{ name: 'wave', url: 'https://cdn.example/wave.png', format: 1, tags: 'wave' }, { name: 'lottie', url: 'https://cdn.example/l.json', format: 3, tags: 'x' }],
  automod: [{ name: 'No links', eventType: 1, triggerType: 1, triggerMetadata: { keywordFilter: ['http'] }, actions: [{ type: 1, metadata: {} }, { type: 2, metadata: { channelId: 'c-1' } }], enabled: true, exemptRoles: ['r-1'], exemptChannels: [] }],
};

(async () => {
  // What it would do, before doing it.
  const { guild, calls } = fakeGuild();
  const merge = planRestore(guild, snapshot, { mode: 'merge' });
  assert.deepEqual([merge.roles.create, merge.channels.create, merge.deleteChannels.length, merge.deleteRoles.length], [2, 3, 0, 0], 'merge creates and deletes nothing');
  const replace = planRestore(guild, snapshot, { mode: 'replace', keepChannelIds: ['c-here'] });
  assert.deepEqual(replace.deleteChannels, ['old-channel'], 'replace names what it would delete, and keeps the channel it was started from');
  assert.deepEqual(replace.deleteRoles, ['old-role']);
  assert.equal(calls.created.length + calls.deleted.length, 0, 'planning touches nothing');

  // The fuller backup: stickers that can be uploaded again and AutoMod rules, counted and restored.
  assert.deepEqual([merge.stickers.create, merge.stickers.skip, merge.automod.create], [1, 1, 1], 'the plan counts stickers (not the Lottie ones) and rules');
  assert.equal(merge.steps, 3 + 1 + 3 + 1 + 0 + 2 + 1, 'every step is counted');

  // Progress reaches the end, and what is deleted is only what was said.
  const steps = [];
  const done = await restoreBackup(guild, snapshot, { mode: 'replace', keepChannelIds: ['c-here'], onProgress: (step) => steps.push(step) });
  assert.equal(steps.at(-1).done, steps.at(-1).total, 'the progress ends complete');
  assert.ok(steps.every((step, i) => i === 0 || step.done === steps[i - 1].done + 1), 'one step at a time');
  assert.deepEqual(calls.deleted.sort(), ['channel:old-channel', 'role:old-role']);
  assert.ok(calls.created.includes('sticker:wave') && calls.created.includes('automod:No links'), 'the sticker and the rule are put back');
  assert.equal(done.stickers.skipped, 1, 'a sticker that cannot be uploaded is skipped, not failed');
  assert.equal(done.cancelled, false);

  // Stopped half way: it keeps what it did, deletes nothing.
  const stopping = fakeGuild();
  let asked = 0;
  const stopped = await restoreBackup(stopping.guild, snapshot, { mode: 'replace', shouldStop: () => ++asked > 4 });
  assert.equal(stopped.cancelled, true);
  assert.equal(stopping.calls.deleted.length, 0, 'a stopped restore deletes nothing');
  assert.ok(stopping.calls.created.length > 0 && stopping.calls.created.length < 5, 'and keeps what was already done');

  // A channel that could not be created: nothing is deleted, because it would be lost for good.
  const failing = fakeGuild({ failCreate: true });
  const failed = await restoreBackup(failing.guild, snapshot, { mode: 'replace' });
  assert.equal(failed.deletionSkipped, 'failures');
  assert.equal(failing.calls.deleted.length, 0);

  // Only some parts: "only the channels" in replace mode creates channels, never touches or deletes a role, and keeps the permissions
  // pointed at the roles that are still there; "only the roles" deletes no channel.
  assert.deepEqual([...restoreParts('roles, channels,nope')], ['roles', 'channels']);
  assert.equal(restoreParts('').size, 6, 'nothing named is everything'); assert.equal(restoreParts(['nope']).size, 6);
  const onlyChannels = fakeGuild();
  const channelPlan = planRestore(onlyChannels.guild, snapshot, { mode: 'replace', keepChannelIds: ['c-here'], parts: ['channels'] });
  assert.deepEqual([channelPlan.parts, channelPlan.roles.create, channelPlan.channels.create, channelPlan.deleteRoles.length, channelPlan.deleteChannels], [['channels'], 0, 3, 0, ['old-channel']], 'the plan only counts the channels');
  const channelsDone = await restoreBackup(onlyChannels.guild, snapshot, { mode: 'replace', keepChannelIds: ['c-here'], parts: 'channels' });
  assert.deepEqual(onlyChannels.calls.created.sort(), ['channel:general', 'channel:rules', 'channel:voice'], 'only channels are made');
  assert.deepEqual(onlyChannels.calls.deleted, ['channel:old-channel'], 'and no role is deleted');
  assert.deepEqual(channelsDone.parts, ['channels']); assert.equal(channelsDone.roles.created + channelsDone.stickers.created + channelsDone.automod.created, 0);
  const onlyRoles = fakeGuild();
  await restoreBackup(onlyRoles.guild, snapshot, { mode: 'replace', parts: ['roles'] });
  assert.deepEqual(onlyRoles.calls.created.sort(), ['role:Members', 'role:Mods']);
  assert.deepEqual(onlyRoles.calls.deleted, ['role:old-role'], 'only the roles are replaced; channels stay');
  // Permissions of channels restored without their roles still point at the roles that exist.
  const keepPerms = fakeGuild();
  keepPerms.guild.roles.cache.set('r-1', { id: 'r-1', name: 'Mods', managed: false, edit: async () => {} });
  let made = null;
  const create = keepPerms.guild.channels.create;
  keepPerms.guild.channels.create = async (data) => { if (data.name === 'general') made = data; return create(data); };
  await restoreBackup(keepPerms.guild, { ...snapshot, channels: [{ ...snapshot.channels[0], permissionOverwrites: [{ id: 'r-1', type: 0, allow: '1024', deny: '0' }, { id: 'r-gone', type: 0, allow: '0', deny: '1024' }] }] }, { parts: ['channels'] });
  assert.deepEqual(made.permissionOverwrites.map((o) => o.id), ['r-1'], 'an existing role keeps its permission; a missing one is left out');
  // What a backup holds.
  assert.deepEqual(backupContents({ ...snapshot, channels: [...snapshot.channels, { id: 'k', name: 'Info', type: 4, permissionOverwrites: [{ id: 'r-1' }] }] }), { roles: 2, categories: 1, channels: 3, overwrites: 1, emojis: 0, stickers: 2, automod: 1, settings: 1 });

  // The human check: a picture works once, five wrong answers lock, and a stranger cannot use it.
  const some = fakeGuild().guild;
  const letters = jobs.createRestoreChallenge(some, 'u1');
  assert.equal(letters.kind, 'letters');
  assert.ok(letters.png.length > 500, 'it has a picture');
  assert.equal(jobs.checkRestoreChallenge(letters.id, some.id, 'u2', 'ABCD').reason, 'expired', 'another person cannot use it');
  config.verifyTokenSecret = null;
  const named = jobs.createRestoreChallenge(some, 'u1');
  assert.equal(named.kind, 'name', 'without the secret of the letters it asks for the name of the server');
  assert.equal(jobs.checkRestoreChallenge(named.id, some.id, 'u1', 'Test server').ok, true);
  assert.equal(jobs.checkRestoreChallenge(named.id, some.id, 'u1', 'Test server').reason, 'expired', 'a picture works once');
  let last;
  for (let i = 0; i < 5; i += 1) last = jobs.checkRestoreChallenge(jobs.createRestoreChallenge(some, 'u3').id, some.id, 'u3', 'nope');
  assert.equal(last.reason, 'locked', 'five wrong answers lock');
  assert.equal(jobs.checkRestoreChallenge(jobs.createRestoreChallenge(some, 'u3').id, some.id, 'u3', 'Test server').reason, 'locked');

  // One at a time in a server, and it can be stopped.
  const server = fakeGuild();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ended = [];
  const job = jobs.startRestoreJob(server.guild, { userId: 'u1', number: 3, mode: 'merge', snapshot, reason: 'test', prepare: async () => { await gate; return 7; }, finish: async (j) => ended.push(j.status) });
  assert.equal(jobs.isRunning(server.guild.id), true);
  assert.throws(() => jobs.startRestoreJob(server.guild, { userId: 'u1', number: 3, mode: 'merge', snapshot, prepare: async () => 1 }), { code: 'restore_running' });
  assert.equal(jobs.cancelJob(server.guild.id), true);
  assert.equal(jobs.describeJob(job).status, 'cancelling');
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(jobs.describeJob(jobs.getJob(server.guild.id)).status, 'cancelled');
  assert.deepEqual(ended, ['cancelled']);
  assert.equal(server.calls.created.length, 0, 'stopped before it started, it touched nothing');
  assert.equal(jobs.isRunning(server.guild.id), false);
  console.log('Checked the backup restore: plan, progress, stop, safe deletion, human check and one at a time.');
})().catch((error) => { console.error(error); process.exit(1); });
