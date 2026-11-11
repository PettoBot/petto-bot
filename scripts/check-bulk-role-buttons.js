// Checks the buttons under the card of a mass role job: which ones each state gets, how they look (emoji, color, words in the three languages), who may press
// them (Administrators), what each one does to the job, and that a card that was left behind does nothing.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { MessageFlags, ButtonStyle } = require('discord.js');
const i18n = require('../src/i18n');
const jobsDb = require('../src/db/bulkRoleJobs');
const jobsRunner = require('../src/jobs/bulkRoleJob');
const icons = require('../src/music/icons');
const { EMOJI } = require('../src/utils/emojis');
const { textCard } = require('../src/utils/caseCard');
const buttons = require('../src/utils/bulkRoleButtons');

const GUILD = '111111111111111111';
const ROLE = '222222222222222222';
i18n.setCachedGuildLanguage(GUILD, 'en');
const enc = (value) => JSON.parse(JSON.stringify(value, (_key, inner) => (inner && typeof inner.toJSON === 'function' ? inner.toJSON() : inner)));
const rowsOf = (container) => enc(container).components.filter((part) => part.type === 1);

const job = (extra = {}) => ({
  id: 41, guild_id: GUILD, action: 'add', target_role_id: ROLE, member_type: 'humans', filter_role_ids: ['333333333333333333'], filter_mode: 'any', filter_exclude: true,
  joined_after: '2025-01-01T00:00:00.000Z', joined_before: null, min_roles: 1, max_roles: 5, skip_pending: true, dry_run: false, reason: 'cleanup', status: 'running', paused: false,
  total_members: 100, processed_members: 40, success_count: 30, skipped_count: 8, error_count: 2, ...extra,
});

(async () => {
  // ---- which buttons each state gets
  assert.deepEqual(buttons.actionsFor(job({ status: 'completed', dry_run: true })), ['start', 'discard'], 'a preview that ended: start it for real or throw it away');
  assert.deepEqual(buttons.actionsFor(job({ status: 'running' })), ['pause', 'cancel']);
  assert.deepEqual(buttons.actionsFor(job({ status: 'pending' })), ['pause', 'cancel']);
  assert.deepEqual(buttons.actionsFor(job({ status: 'running', paused: true })), ['resume', 'cancel'], 'a paused job gets "continue" instead of "pause"');
  assert.deepEqual(buttons.actionsFor(job({ status: 'running', dry_run: true })), ['pause', 'cancel'], 'a preview that is still running can be paused and cancelled');
  for (const status of ['completed', 'failed', 'cancelled']) assert.deepEqual(buttons.actionsFor(job({ status })), [], `a job that is ${status} has no buttons`);

  // ---- how they look
  const row = rowsOf(buttons.withButtons(textCard('x'), job({ status: 'completed', dry_run: true }), 'en'))[0];
  assert.deepEqual(row.components.map((button) => button.custom_id), ['bulkrole:start:41', 'bulkrole:discard:41']);
  assert.deepEqual(row.components.map((button) => button.label), ['Apply', 'Discard']);
  assert.equal(row.components[0].style, ButtonStyle.Success);
  assert.ok(String(icons.PLAY).includes(row.components[0].emoji.id), 'start uses the play of the music icons');
  assert.ok(String(EMOJI.DELETE).includes(row.components[1].emoji.id), 'discard uses the trash can');
  const running = rowsOf(buttons.withButtons(textCard('x'), job(), 'es'))[0].components;
  assert.deepEqual(running.map((button) => button.label), ['Pausar', 'Cancelar']);
  assert.ok(String(icons.PAUSE).includes(running[0].emoji.id) && String(icons.STOP).includes(running[1].emoji.id));
  assert.equal(running[1].style, ButtonStyle.Danger, 'cancel is red');
  assert.deepEqual(rowsOf(buttons.withButtons(textCard('x'), job({ paused: true }), 'pt-BR'))[0].components.map((button) => button.label), ['Continuar', 'Cancelar']);
  assert.deepEqual(rowsOf(buttons.withButtons(textCard('x'), job({ status: 'completed' }), 'en')), [], 'no row when there is nothing to press');
  for (const lang of ['en', 'es', 'pt-BR']) for (const action of ['start', 'discard', 'pause', 'resume', 'cancel']) {
    const text = i18n.t(lang, `moderation.bulkRole.button.${action}`);
    assert.ok(text && !text.includes('moderation.bulkRole.button'), `${lang} has the word for ${action}`);
    assert.ok(text.length <= 80, 'a button label has at most 80 characters');
  }

  // ---- reading the id of a button
  assert.deepEqual(buttons.parseCustomId('bulkrole:cancel:7'), { action: 'cancel', jobId: '7' });
  for (const bad of ['music:play', 'bulkrole:explode:7', 'bulkrole:start:abc', 'bulkrole:start', 'bulkrole:start:']) assert.equal(buttons.parseCustomId(bad), null, bad);

  // ---- what a click does
  const calls = [];
  let stored = job();
  let active = null;
  jobsDb.getJob = async (id) => (String(id) === '41' ? stored : null);
  jobsDb.getActiveJob = async () => active;
  jobsDb.setPaused = async (...args) => { calls.push(['setPaused', ...args]); return true; };
  jobsDb.cancelJob = async (...args) => { calls.push(['cancelJob', ...args]); };
  jobsDb.createJob = async (row) => { calls.push(['createJob', row]); return { ...row, id: 99, status: 'pending', paused: false, total_members: 0, processed_members: 0, success_count: 0, skipped_count: 0, error_count: 0 }; };
  jobsDb.updateJob = async (...args) => { calls.push(['updateJob', ...args]); };
  jobsRunner.runJob = (_client, started) => { calls.push(['runJob', started.id, started.progress_message_id]); };

  const role = { id: ROLE, name: 'Member', managed: false, position: 3, permissions: { bitfield: 0n } };
  const click = (customId, { admin = true, guildId = GUILD, roleAbove = false } = {}) => {
    const log = { replies: [], updates: [], followUps: [], deferred: 0 };
    const interaction = {
      customId, guildId, channelId: '555555555555555555', user: { id: '777777777777777777' }, client: {},
      memberPermissions: { has: (flag) => admin && flag === 'Administrator' },
      guild: { id: GUILD, roles: { cache: new Map([[ROLE, role]]) }, members: { me: { permissions: { has: () => true }, roles: { highest: { position: roleAbove ? 2 : 9 } } } } },
      reply: async (payload) => { log.replies.push(payload); },
      deferUpdate: async () => { log.deferred += 1; },
      update: async (payload) => { log.updates.push(payload); },
      followUp: async (payload) => { log.followUps.push(payload); return { id: '888888888888888888', channelId: '555555555555555555' }; },
    };
    return { interaction, log };
  };
  const press = async (customId, options) => { calls.length = 0; const made = click(customId, options); await buttons.handleBulkRoleButton(made.interaction); return made.log; };

  let log = await press('bulkrole:cancel:41', { admin: false });
  assert.equal(log.replies.length, 1);
  assert.equal(log.replies[0].flags, MessageFlags.Ephemeral, 'the refusal is private');
  assert.deepEqual(calls, [], 'someone who is not an Administrator changes nothing');

  log = await press('bulkrole:cancel:41', { guildId: '999999999999999999' });
  assert.deepEqual(calls, [], 'a job of another server is not touched');
  assert.equal(log.replies.length, 1);

  log = await press('bulkrole:pause:41');
  assert.deepEqual(calls, [['setPaused', 41, GUILD, true]]);
  assert.equal(log.deferred, 1, 'the card is not answered: the engine edits it');
  stored = job({ paused: true });
  await press('bulkrole:resume:41');
  assert.deepEqual(calls, [['setPaused', 41, GUILD, false]]);
  await press('bulkrole:cancel:41');
  assert.deepEqual(calls, [['cancelJob', 41, GUILD]]);

  // A card that was left behind: the job is not in a state that has that button.
  stored = job({ status: 'completed' });
  log = await press('bulkrole:pause:41');
  assert.deepEqual(calls, [], 'pausing a job that ended does nothing');
  assert.equal(log.replies.length, 1);
  stored = job({ status: 'running' });
  log = await press('bulkrole:start:41');
  assert.deepEqual(calls, [], 'a job that is not a finished preview cannot be started');

  // Discard.
  stored = job({ status: 'completed', dry_run: true });
  log = await press('bulkrole:discard:41');
  assert.deepEqual(calls, [], 'discarding changes nothing in the server and creates nothing');
  assert.equal(log.updates.length, 1);
  const discarded = enc(log.updates[0].components[0]);
  assert.ok(JSON.stringify(discarded).includes('Preview discarded'), 'the card says it was discarded');
  assert.deepEqual(discarded.components.filter((part) => part.type === 1), [], 'and has no buttons any more');

  // Start for real: refused while another job runs, and when the role cannot be given.
  active = { id: 5 };
  log = await press('bulkrole:start:41');
  assert.deepEqual(calls, [], 'one job at a time');
  assert.equal(log.replies.length, 1);
  active = null;
  log = await press('bulkrole:start:41', { roleAbove: true });
  assert.deepEqual(calls, [], 'a role above Petto is refused before anything is created');
  assert.equal(log.replies.length, 1);

  // Start for real: the same members, without the preview, with its own card and buttons.
  log = await press('bulkrole:start:41');
  const created = calls.find((call) => call[0] === 'createJob')[1];
  assert.equal(created.dry_run, false, 'it is not a preview');
  assert.deepEqual([created.action, created.target_role_id, created.member_type, created.filter_role_ids, created.filter_exclude, created.joined_after, created.min_roles, created.max_roles, created.skip_pending, created.reason, created.started_by],
    ['add', ROLE, 'humans', ['333333333333333333'], true, '2025-01-01T00:00:00.000Z', 1, 5, true, 'cleanup', '777777777777777777'], 'the same filters as the preview, started by who pressed');
  assert.equal(log.updates.length, 1);
  const old = enc(log.updates[0].components[0]);
  assert.ok(JSON.stringify(old).includes('#99') && old.components.filter((part) => part.type === 1).length === 0, 'the preview says which job it became and loses its buttons');
  assert.equal(log.followUps.length, 1);
  assert.deepEqual(rowsOf(log.followUps[0].components[0])[0].components.map((button) => button.custom_id), ['bulkrole:pause:99', 'bulkrole:cancel:99'], 'the new job has its own pause and cancel');
  assert.deepEqual(calls.filter((call) => call[0] === 'updateJob')[0].slice(1), [99, { progress_channel_id: '555555555555555555', progress_message_id: '888888888888888888' }], 'the card is remembered so the engine can follow it');
  assert.deepEqual(calls.at(-1), ['runJob', 99, '888888888888888888'], 'and the job starts');

  console.log('Mass role button checks passed (states, looks, words, permissions, pause/continue/cancel, discard, start for real).');
})().catch((err) => { console.error(err); process.exit(1); });
