// The restore of a backup: what it says before it does anything, how it reports progress, that it can be stopped, that it never deletes
// when something failed or when it was stopped, that only one runs at a time, and the human check that opens it.
const assert = require('node:assert/strict');

const stub = (relative, exports) => { const file = require.resolve(relative); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
const config = { verifyTokenSecret: 'a-secret-for-the-check-of-the-restore-pictures' };
stub('../src/config', config);
stub('../src/utils/logger', { warn() {}, info() {}, error() {} });
const { planRestore, restoreBackup } = require('../src/utils/backupRestore');
const jobs = require('../src/utils/backupJobs');

function fakeGuild({ failCreate = false } = {}) {
  const channels = new Map();
  const roles = new Map();
  const calls = { deleted: [], created: [] };
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

  // Progress reaches the end, and what is deleted is only what was said.
  const steps = [];
  const done = await restoreBackup(guild, snapshot, { mode: 'replace', keepChannelIds: ['c-here'], onProgress: (step) => steps.push(step) });
  assert.equal(steps.at(-1).done, steps.at(-1).total, 'the progress ends complete');
  assert.ok(steps.every((step, i) => i === 0 || step.done === steps[i - 1].done + 1), 'one step at a time');
  assert.deepEqual(calls.deleted.sort(), ['channel:old-channel', 'role:old-role']);
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
