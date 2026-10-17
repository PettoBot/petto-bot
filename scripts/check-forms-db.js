// Checks the tables of forms against a real PostgreSQL database: schema.sql applies twice, forms are unique by name per server,
// submissions are numbered per server, a review only answers what is pending, the counts a form's rules read, and panels.
// It runs when PETTO_TEST_DATABASE_URL points to an empty test database, and is skipped otherwise.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the forms database check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
const formsDb = require('../src/db/forms');
const forms = require('../src/utils/forms');
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const G1 = '100000000000000001';
const G2 = '100000000000000002';

(async () => {
  const pool = getPrimaryPool();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(schema); // the bot applies it on every start
  await pool.query('delete from forms where guild_id in ($1, $2)', [G1, G2]);
  const subsPool = pool;
  await subsPool.query('delete from form_submissions where guild_id in ($1, $2)', [G1, G2]);
  await pool.query('insert into guilds (guild_id) values ($1), ($2) on conflict do nothing', [G1, G2]);

  const made = await formsDb.createForm(G1, forms.normalizeForm({ name: 'staff', title: 'Staff', questions: [{ type: 'choice', label: 'Team', options: ['A', 'B'] }], reviewer_role_ids: ['123456789012345678'] }));
  assert.equal(made.status, 'closed'); assert.deepEqual(made.reviewer_role_ids, ['123456789012345678']); assert.equal(made.questions[0].options.length, 2, 'the questions are stored as JSON');
  await assert.rejects(formsDb.createForm(G1, forms.normalizeForm({ name: 'staff', title: 'Again' })), (err) => err.code === '23505', 'a name is used once per server');
  const other = await formsDb.createForm(G2, forms.normalizeForm({ name: 'staff', title: 'Other server' }));
  assert.notEqual(other.id, made.id, 'another server can use the same name');
  assert.equal((await formsDb.getForm(G1, 'STAFF')).id, made.id, 'by name');
  assert.equal((await formsDb.getForm(G1, String(made.id))).name, 'staff', 'by number');
  assert.equal(await formsDb.getForm(G1, other.id), null, 'never the form of another server');
  await assert.rejects(pool.query("insert into forms (guild_id, name, title) values ($1, 'Bad Name', 'x')", [G1]), /check/, 'the database refuses a bad name');
  assert.equal(await formsDb.countForms(G1), 1);
  const updated = await formsDb.updateForm(G1, made.id, { status: 'open', accept_add_role_ids: ['223456789012345678'], messages: { accepted: { text: 'Hi {user}' } } });
  assert.equal(updated.status, 'open'); assert.equal(updated.messages.accepted.text, 'Hi {user}');

  const sub = (user) => ({ guild_id: G1, form_id: made.id, form_name: 'staff', form_title: 'Staff', user_id: user, username: user, answers: [{ id: 'q1', label: 'Team', type: 'choice', value: 'A' }] });
  const [a, b] = await Promise.all([formsDb.createSubmission(sub('u1')), formsDb.createSubmission(sub('u2'))]);
  assert.deepEqual([a.number, b.number].sort(), [1, 2], 'two at the same moment get their own numbers');
  const c = await formsDb.createSubmission({ ...sub('u1'), guild_id: G2, form_id: other.id });
  assert.equal(c.number, 1, 'numbers are per server');
  assert.deepEqual(await formsDb.memberStats(G1, made.id, 'u1'), { pending: 1, total: 1, lastDeniedAt: null });
  const first = a.user_id === 'u1' ? a : b;
  const denied = await formsDb.resolveSubmission(G1, first.number, { status: 'denied', reviewer_id: 'r', reviewed_at: new Date().toISOString(), reason: 'No' });
  assert.equal(denied.status, 'denied');
  assert.equal(await formsDb.resolveSubmission(G1, first.number, { status: 'accepted' }), null, 'only a pending one can be answered');
  const stats = await formsDb.memberStats(G1, made.id, 'u1');
  assert.equal(stats.pending, 0); assert.ok(stats.lastDeniedAt, 'the last denial is known, for the wait after it');
  assert.equal(await formsDb.countFormSubmissions(G1, made.id), 2);
  assert.equal((await formsDb.listSubmissions(G1, { status: 'pending' })).length, 1);
  assert.equal((await formsDb.listSubmissions(G1, { formId: made.id })).length, 2);

  const panel = await formsDb.createPanel(G1, { channel_id: '323456789012345678', form_ids: [made.id], style: 'select' });
  assert.deepEqual(panel.form_ids.map(Number), [Number(made.id)]);
  await formsDb.updatePanel(G1, panel.id, { message_id: '423456789012345678' });
  assert.equal((await formsDb.getPanel(G1, panel.id)).message_id, '423456789012345678');

  // Retention: the answers of reviewed submissions older than the setting go, the small row stays; pending ones are never touched.
  assert.equal((await formsDb.getFormConfig(G1)).retention_days, 30, '30 days by default');
  await formsDb.setFormConfig(G1, { retention_days: 7 });
  assert.deepEqual((await formsDb.listRetentionConfigs()).filter((r) => r.guild_id === G1).map((r) => r.retention_days), [7]);
  await subsPool.query("update form_submissions set reviewed_at = now() - interval '8 days' where guild_id = $1 and number = $2", [G1, first.number]);
  assert.equal(await formsDb.compactBefore(30, { except: [G1] }), 0, 'a server with its own setting is left to it');
  assert.equal(await formsDb.compactBefore(7, { guildId: G1 }), 1);
  const small = await formsDb.getSubmission(G1, first.number);
  assert.equal(small.compacted, true); assert.deepEqual(small.answers, []); assert.equal(small.status, 'denied'); assert.equal(small.reviewer_id, 'r');
  assert.equal((await formsDb.getSubmission(G1, first.number === 1 ? 2 : 1)).answers.length, 1, 'a pending one keeps its answers');
  assert.equal(await formsDb.compactBefore(7, { guildId: G1 }), 0, 'compacted once');
  // The cap: the oldest reviewed ones go, pending ones stay.
  assert.deepEqual(await formsDb.countStored(G1), { total: 2, pending: 1 });
  assert.equal(await formsDb.trimOldest(G1, 1), 1);
  assert.deepEqual(await formsDb.countStored(G1), { total: 1, pending: 1 });
  assert.equal(await formsDb.trimOldest(G1, 0), 0, 'a pending submission is never deleted to make room');

  await formsDb.deleteForm(G1, made.id);
  const kept = (await formsDb.listSubmissions(G1, {}))[0];
  assert.equal(kept.form_title, 'Staff', 'what was sent stays when its form is deleted');
  assert.equal(kept.form_id, null);
  await subsPool.query('delete from form_submissions where guild_id in ($1, $2)', [G1, G2]);

  await pool.query('delete from guilds where guild_id in ($1, $2)', [G1, G2]);
  await closePools();
  console.log('Checked the forms tables against a real database: numbers, reviews, retention and the cap.');
})().catch((error) => { console.error(error); process.exit(1); });
