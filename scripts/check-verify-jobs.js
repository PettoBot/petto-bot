// The verification from the dashboard as a job (src/utils/verifyJobs.js) and the gate role that hides every channel (src/utils/verifyRole.js),
// with Discord, the storage and the setup itself replaced: one job per server, its progress, its answer and its failure; the channels
// edited a few at a time, only where needed, and one gate role even when two ask for it at once.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const saved = [];
let stored = {};
stub('src/db/verificationConfig.js', { getConfig: async () => ({ ...stored }), upsertConfig: async (_id, patch) => { saved.push(patch); stored = { ...stored, ...patch }; return { ...stored }; } });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

// The setup is replaced: each test says what it does.
let runner = null;
stub('src/utils/verifyProvision.js', {
  setupEverything: (guild, options) => runner('setup', guild, options),
  sendPanelNow: (guild, options) => runner('panel', guild, options),
  setEnabled: (guild, enabled, options) => runner(enabled ? 'enable' : 'disable', guild, options),
});

const { ensureUnverifiedRole, gateChannels } = require('../src/utils/verifyRole');
const jobs = require('../src/utils/verifyJobs');
const { postPanel } = require('../src/utils/verifyPanel');
const { buildPanel } = require('../src/interactions/verifyLetters');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const flags = (list) => ({ has: (flag) => list.includes(flag) });

function makeChannel(id, { type = ChannelType.GuildText, canEdit = true, overwrite = null, edits, inFlight } = {}) {
  const overwrites = new Map(overwrite ? [[overwrite.id, { allow: flags(overwrite.allow ?? []), deny: flags(overwrite.deny ?? []) }]] : []);
  return {
    id,
    name: `c${id}`,
    type,
    permissionsFor: () => ({ has: (wanted) => canEdit || ![].concat(wanted).includes(PermissionFlagsBits.ManageRoles) }),
    permissionOverwrites: {
      cache: overwrites,
      edit: async (role, perms) => {
        inFlight.now += 1;
        inFlight.max = Math.max(inFlight.max, inFlight.now);
        await sleep(5);
        inFlight.now -= 1;
        edits.push([id, role.id, perms.ViewChannel]);
      },
    },
  };
}

function makeGuild(id, channelSpecs = []) {
  const edits = [];
  const inFlight = { now: 0, max: 0 };
  const channels = new Map(channelSpecs.map((spec, i) => [String(i), makeChannel(String(i), { ...spec, edits, inFlight })]));
  let made = 0;
  const roles = new Map();
  return {
    id,
    edits,
    inFlight,
    members: { me: { id: 'me' } },
    channels: { cache: channels },
    roles: {
      cache: roles,
      get made() { return made; },
      create: async ({ name }) => { made += 1; await sleep(5); const role = { id: `gate-${made}`, name }; roles.set(role.id, role); return role; },
    },
  };
}

(async () => {
  // The channels: only the ones that need it, three at a time, with the progress after each one.
  {
    const role = { id: 'gate' };
    const specs = [
      ...Array.from({ length: 10 }, () => ({})),
      { type: ChannelType.GuildCategory },
      { type: ChannelType.GuildVoice },
      { type: ChannelType.PublicThread }, // threads follow their channel
      { overwrite: { id: 'gate', deny: [PermissionFlagsBits.ViewChannel] } }, // already hidden
      { overwrite: { id: 'gate', allow: [PermissionFlagsBits.ViewChannel] } }, // opened on purpose (the rules): kept
      { canEdit: false }, // Petto cannot edit it: no request that would only fail
    ];
    const guild = makeGuild('g-channels', specs);
    const progress = [];
    const counts = await gateChannels(guild, role, { reason: 'check', onProgress: (step) => progress.push({ ...step }) });
    assert.deepEqual(counts, { total: 12, changed: 12, failed: 0, kept: 2, noAccess: 1 });
    assert.equal(guild.edits.length, 12);
    assert.ok(guild.edits.every(([, roleId, view]) => roleId === 'gate' && view === false));
    assert.ok(guild.inFlight.max > 1 && guild.inFlight.max <= 3, `edits at once: ${guild.inFlight.max}`);
    assert.deepEqual(progress[0], { phase: 'channels', done: 0, total: 12 });
    assert.deepEqual(progress.at(-1), { phase: 'channels', done: 12, total: 12 });
    assert.equal(progress.length, 13);
  }

  // Two asking for the gate role at once (the dashboard and a member who joins): one role, the channels edited once, both get it.
  {
    const guild = makeGuild('g-role', Array.from({ length: 6 }, () => ({})));
    const seen = [];
    const [a, b] = await Promise.all([
      ensureUnverifiedRole(guild, {}, { onProgress: (step) => seen.push(['a', step.done]) }),
      ensureUnverifiedRole(guild, {}, { onProgress: (step) => seen.push(['b', step.done]) }),
    ]);
    assert.equal(guild.roles.made, 1);
    assert.equal(a, b);
    assert.equal(guild.edits.length, 6);
    assert.ok(seen.some(([who]) => who === 'a') && seen.some(([who]) => who === 'b'), 'both see the progress');
    assert.deepEqual(saved.at(-1), { unverified_role_id: a.id });
    // Once it exists, nothing is asked of Discord.
    const again = await ensureUnverifiedRole(guild, { unverified_role_id: a.id });
    assert.equal(again, a);
    assert.equal(guild.roles.made, 1);
    assert.equal(guild.edits.length, 6);
  }

  // A long job: one per server, the progress while it runs, then its answer.
  {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    runner = async (action, guild, { onProgress }) => {
      calls += 1;
      onProgress({ phase: 'roles', done: 0, total: 0 });
      onProgress({ phase: 'channels', done: 34, total: 120 });
      await gate;
      onProgress({ phase: 'panel', done: 0, total: 0 });
      return { ok: true, message: 'Verification is ready.' };
    };
    const guild = { id: 'g-job' };
    const first = jobs.startVerifyJob(guild, 'setup', { userId: 'u1' });
    assert.equal(first.already, false);
    assert.equal(await jobs.waitForJob(first.job, 20), false, 'still running');
    const running = jobs.describeJob(jobs.getJob('g-job'), 'en');
    assert.deepEqual([running.status, running.phase, running.done, running.total, running.percent], ['running', 'channels', 34, 120, 28]);
    assert.equal(running.progress, 'Hiding the channels from the gate role: 34/120…');
    assert.equal(jobs.describeJob(jobs.getJob('g-job'), 'es').progress, 'Ocultando los canales al rol sin verificar: 34/120…');
    assert.equal(jobs.isRunning('g-job'), true);

    // A second press (or another button) while it runs gets the same job, and nothing new starts.
    const second = jobs.startVerifyJob(guild, 'panel');
    assert.equal(second.already, true);
    assert.equal(second.job, first.job);
    assert.equal(calls, 1);

    // Another server is not held up by this one.
    const other = jobs.startVerifyJob({ id: 'g-other' }, 'enable');
    assert.equal(other.already, false);
    release();
    assert.equal(await jobs.waitForJob(first.job, 1_000), true);
    const done = jobs.describeJob(jobs.getJob('g-job'));
    assert.deepEqual([done.status, done.ok, done.message, done.percent], ['done', true, 'Verification is ready.', 100]);
    assert.ok(done.finishedAt >= done.startedAt);
    assert.equal('ended' in done, false, 'the promise is not sent');
    await jobs.waitForJob(other.job, 1_000);

    // After it ended a new one can start.
    assert.equal(jobs.startVerifyJob(guild, 'panel').already, false);
    assert.equal(calls, 3, "the first, the other server and this one");
  }

  // A quick job ends inside the wait, so the route answers it right away.
  {
    runner = async () => ({ ok: true, message: 'The panel is in #verify.' });
    await sleep(5);
    const { job } = jobs.startVerifyJob({ id: 'g-quick' }, 'panel');
    assert.equal(await jobs.waitForJob(job, 1_500), true);
    assert.deepEqual([job.status, job.message], ['done', 'The panel is in #verify.']);
  }

  // The failures: an answer that says no, and an error thrown in the middle.
  {
    runner = async () => ({ ok: false, message: 'I need the Manage Roles permission.' });
    const refused = jobs.startVerifyJob({ id: 'g-refused' }, 'setup').job;
    await jobs.waitForJob(refused, 1_000);
    assert.deepEqual([refused.status, refused.ok, refused.message], ['failed', false, 'I need the Manage Roles permission.']);

    let ended = null;
    runner = async (_action, _guild, { onProgress }) => { onProgress({ phase: 'channels', done: 3, total: 50 }); throw new Error('Missing Access'); };
    const broken = jobs.startVerifyJob({ id: 'g-broken' }, 'setup', { onEnd: (job) => { ended = job.status; } }).job;
    await jobs.waitForJob(broken, 1_000);
    assert.deepEqual([broken.status, broken.ok, broken.message, ended], ['failed', false, 'Missing Access', 'failed']);
    assert.equal(jobs.isRunning('g-broken'), false, 'a failed job does not block the next one');
    assert.equal(jobs.describeJob(broken).percent, 100);
  }

  // The panel is posted once: two posts at the same moment give one message (the second edits it), the gate overwrite is sent once,
  // and a copy left from before is deleted.
  {
    const GUILD = '444444444444444444';
    const counts = { send: 0, edit: 0, overwrite: 0, deleted: [] };
    const messages = new Map();
    let nextId = 1;
    const message = (payload) => {
      const id = `m${nextId++}`;
      const msg = { id, author: { id: 'me' }, components: payload.components, edit: async (changed) => { counts.edit += 1; msg.components = changed.components; return msg; }, delete: async () => { counts.deleted.push(id); messages.delete(id); } };
      messages.set(id, msg);
      return msg;
    };
    const overwrites = new Map();
    const guild = {
      id: GUILD,
      name: 'Panel HQ',
      members: { me: { id: 'me' } },
      roles: { cache: new Map([['gate', { id: 'gate' }]]) },
    };
    const channel = {
      id: 'verify',
      isTextBased: () => true,
      permissionsFor: () => ({ has: () => true }),
      permissionOverwrites: { cache: overwrites, edit: async (role, perms) => {
        counts.overwrite += 1;
        await sleep(5);
        const allow = Object.entries(perms).filter(([, v]) => v === true).map(([k]) => PermissionFlagsBits[k]);
        const deny = Object.entries(perms).filter(([, v]) => v === false).map(([k]) => PermissionFlagsBits[k]);
        overwrites.set(role.id, { allow: flags(allow), deny: flags(deny) });
      } },
      messages: { fetch: async (what) => (typeof what === 'string' ? messages.get(what) ?? null : new Map(messages)), delete: async (id) => { if (!messages.has(id)) throw new Error('Unknown Message'); messages.delete(id); } },
      send: async (payload) => { counts.send += 1; await sleep(5); return message(payload); },
    };
    guild.channels = { fetch: async () => channel };
    // A copy from before (posted twice), and a message of somebody else.
    const old = message(buildPanel({ guild, method: 'turnstile', lang: 'en' }));
    messages.set('other', { id: 'other', author: { id: 'someone' }, components: [], delete: async () => { counts.deleted.push('other'); } });
    stored = { enabled: true, unverified_role_id: 'gate', panel_channel_id: 'verify' };
    const [a, b] = await Promise.all([postPanel(guild, { ...stored }, channel), postPanel(guild, { ...stored }, channel)]);
    assert.equal(counts.send, 1, 'one message');
    assert.equal(counts.edit, 1, 'the second post edits it');
    assert.equal(a.id, b.id);
    assert.equal(counts.overwrite, 1, 'the channel is opened to the gate role once');
    assert.deepEqual(counts.deleted, [old.id], 'the old copy is deleted, nothing else');
    assert.deepEqual([stored.panel_message_id, stored.panel_posted_channel_id], [a.id, 'verify']);
    // Posting again later edits the same message.
    const again = await postPanel(guild, { ...stored }, channel);
    assert.deepEqual([again.id, counts.send, counts.edit], [a.id, 1, 2]);
    // The message was deleted by hand: a new one is sent.
    messages.delete(a.id);
    const fresh = await postPanel(guild, { ...stored }, channel);
    assert.notEqual(fresh.id, a.id);
    assert.equal(counts.send, 2);
  }

  assert.throws(() => jobs.startVerifyJob({ id: 'g' }, 'disable'), /Unknown verification job/);
  assert.equal(jobs.describeJob(null), null);
  console.log('verify jobs ok');
})().catch((err) => { console.error(err); process.exit(1); });
