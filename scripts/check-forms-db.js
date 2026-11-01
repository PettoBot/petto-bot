// Checks the tables of forms against a real PostgreSQL database: schema.sql applies twice, forms are unique by name per server,
// forms and submissions are numbered per server (the numbers of existing forms are filled in once, in creation order), a review only answers what is pending, the counts a form's rules read, and panels.
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
const appealsDb = require('../src/db/appeals');
const forms = require('../src/utils/forms');
const { getPrimaryPool, closePools } = require('../src/db/postgres');

const G1 = '100000000000000001';
const G2 = '100000000000000002';
const G3 = '100000000000000003';
const G4 = '100000000000000004';

(async () => {
  const pool = getPrimaryPool();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(schema); // the bot applies it on every start
  await pool.query('delete from forms where guild_id in ($1, $2, $3, $4)', [G1, G2, G3, G4]);
  const subsPool = pool;
  await subsPool.query('delete from form_submissions where guild_id in ($1, $2)', [G1, G2]);
  await pool.query('insert into guilds (guild_id) values ($1), ($2), ($3), ($4) on conflict do nothing', [G1, G2, G3, G4]);

  const made = await formsDb.createForm(G1, forms.normalizeForm({ name: 'staff', title: 'Staff', questions: [{ type: 'choice', label: 'Team', options: ['A', 'B'] }], reviewer_role_ids: ['123456789012345678'] }));
  assert.equal(made.status, 'closed'); assert.deepEqual(made.reviewer_role_ids, ['123456789012345678']); assert.equal(made.questions[0].options.length, 2, 'the questions are stored as JSON');
  await assert.rejects(formsDb.createForm(G1, forms.normalizeForm({ name: 'staff', title: 'Again' })), (err) => err.code === '23505', 'a name is used once per server');
  const other = await formsDb.createForm(G2, forms.normalizeForm({ name: 'staff', title: 'Other server' }));
  assert.notEqual(other.id, made.id, 'another server can use the same name');
  assert.equal((await formsDb.getForm(G1, 'STAFF')).id, made.id, 'by name');
  assert.equal((await formsDb.getForm(G1, String(made.number))).name, 'staff', 'by number');
  assert.equal(await formsDb.getForm(G1, other.id), null, 'never the form of another server');
  assert.equal(await formsDb.getFormById(G1, other.id), null, 'an internal id of another server finds nothing'); assert.equal((await formsDb.getFormById(G1, made.id)).name, 'staff');
  assert.equal(made.number, 1, 'the first form of a server is number 1'); assert.equal(other.number, 1, 'in every server');
  assert.match(made.public_id, forms.PUBLIC_ID, 'a new form gets a public id'); assert.notEqual(made.public_id, other.public_id);
  assert.equal((await formsDb.getFormByPublicId(made.public_id)).id, made.id, 'by public id');
  assert.equal(await formsDb.getFormByPublicId(String(made.number)), null, 'never by number either');
  assert.equal(await formsDb.getFormByPublicId(String(made.id)), null, 'never by number on the web');
  const relinked = await formsDb.renewPublicId(G1, made.id);
  assert.notEqual(relinked.public_id, made.public_id); assert.equal(await formsDb.getFormByPublicId(made.public_id), null, 'the old link stops working');
  const { rows: [byDefault] } = await pool.query("insert into forms (guild_id, name, title) values ($1, 'dash', 'Dashboard') returning public_id, number", [G1]);
  assert.match(byDefault.public_id, forms.PUBLIC_ID, 'forms made by the dashboard get one from the default');
  assert.equal(byDefault.number, 2, 'and the next number of the server from the database (the dashboard inserts the row itself)');
  const { rows: [imposed] } = await pool.query("insert into forms (guild_id, name, title, number) values ($1, 'dash2', 'Dashboard 2', 77) returning number", [G1]);
  assert.equal(imposed.number, 3, 'a number sent in an insert is ignored: the database numbers the forms');
  await pool.query("delete from forms where guild_id = $1 and name = 'dash2'", [G1]);
  // The look of the web page: defaults for a form made without it, the values of normalizeForm, and the database refuses others.
  const { rows: [pageDefault] } = await pool.query("select page_banner, page_background, page_show_icon, page_show_name from forms where guild_id = $1 and name = 'dash'", [G1]);
  assert.deepEqual(pageDefault, { page_banner: null, page_background: 'default', page_show_icon: true, page_show_name: true }, 'a form without a look gets the default page');
  const paged = await formsDb.updateForm(G1, made.id, { page_banner: 'https://x.example/top.webp', page_background: 'gradient', page_show_icon: false });
  assert.deepEqual(forms.pageLook(paged), { banner: 'https://x.example/top.webp', background: 'gradient', show_icon: false, show_name: true, hide_branding: false });
  await assert.rejects(formsDb.updateForm(G1, made.id, { page_background: 'neon' }), (err) => err.code === '23514', 'only the known backgrounds');
  await assert.rejects(formsDb.updateForm(G1, made.id, { page_banner: `https://x.example/${'a'.repeat(500)}.png` }), (err) => err.code === '23514', 'a banner of 500 characters at most');
  const previewed = await formsDb.updateForm(G1, made.id, { embed_title: 'Apply', embed_color: 0x5865f2, embed_thumbnail: true });
  assert.deepEqual(forms.linkEmbed(previewed), { title: 'Apply', description: null, image: null, color: 0x5865f2, thumbnail: true });
  await assert.rejects(formsDb.updateForm(G1, made.id, { embed_color: 0x1000000 }), (err) => err.code === '23514', 'a color of the side in range');
  await assert.rejects(formsDb.updateForm(G1, made.id, { embed_title: 'x'.repeat(91) }), (err) => err.code === '23514', 'a title of 90 characters at most');
  await pool.query("delete from forms where guild_id = $1 and name = 'dash'", [G1]);
  await assert.rejects(pool.query("insert into forms (guild_id, name, title) values ($1, 'Bad Name', 'x')", [G1]), /check/, 'the database refuses a bad name');
  // Numbers: per server, from 1, two forms made at the same moment get their own numbers, a name that is taken does not use one up.
  await assert.rejects(pool.query('update forms set number = 0 where id = $1', [made.id]), (err) => err.code === '23514', 'a number is 1 or more');
  const burst = await Promise.all(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((name) => formsDb.createForm(G3, forms.normalizeForm({ name, title: name }))));
  assert.deepEqual(burst.map((f) => f.number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6], 'six forms made at the same moment are numbered 1 to 6 with no gap and no repeat');
  assert.equal((await formsDb.createForm(G3, { ...forms.normalizeForm({ name: 'viaDb', title: 'x' }), number: 40 })).number, 7, 'createForm ignores a number it is given');
  await assert.rejects(formsDb.createForm(G3, forms.normalizeForm({ name: 'b1', title: 'again' })), (err) => err.code === '23505' && !String(err.constraint).includes('number'), 'a taken name still fails at once');
  assert.equal((await formsDb.createForm(G3, forms.normalizeForm({ name: 'after', title: 'x' }))).number, 8);
  const g3 = await formsDb.listForms(G3);
  assert.deepEqual(g3.map((f) => f.number), [1, 2, 3, 4, 5, 6, 7, 8], 'listForms comes in the order of the numbers');
  await formsDb.deleteForm(G3, g3[2].id); // number 3
  assert.deepEqual((await formsDb.listForms(G3)).map((f) => f.number), [1, 2, 4, 5, 6, 7, 8], 'the others keep their numbers');
  assert.equal((await formsDb.createForm(G3, forms.normalizeForm({ name: 'newer', title: 'x' }))).number, 9, 'the number of a deleted form is not reused while a higher one exists');
  const edited = await formsDb.updateForm(G3, g3[1].id, { title: 'Edited', number: 50, status: 'open' });
  assert.equal(edited.title, 'Edited'); assert.equal(edited.number, 2, 'a form keeps its number after edits (a number in the changes is ignored)');
  assert.equal((await formsDb.renewPublicId(G3, g3[1].id)).number, 2, 'and after a new web link');
  assert.equal((await formsDb.getForm(G3, '2')).name, 'b2'); assert.equal(await formsDb.getForm(G1, '2'), null, 'number 2 of G3 is not number 2 of G1');
  assert.equal(await formsDb.getForm(G3, '3'), null, 'the deleted number finds nothing');
  assert.equal((await formsDb.getForm(G1, '1')).name, 'staff', 'forms made in G3 did not change G1');
  // A number that was never used for a name: a form named with digits is still found by name when no form has that number.
  const digits = await formsDb.createForm(G4, forms.normalizeForm({ name: '2024', title: 'Year' }));
  assert.equal(digits.number, 1); assert.equal((await formsDb.getForm(G4, '2024')).id, digits.id, 'a name made of digits is found by name'); assert.equal((await formsDb.getForm(G4, '1')).id, digits.id);
  await pool.query('delete from forms where guild_id in ($1, $2)', [G3, G4]);
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

  // The migration on a database that already has forms: the column is empty, so the schema fills it once, per server, in the order the
  // forms were made, and never again. (The trigger and the constraint are taken off to bring back the shape of the old table.)
  await pool.query('delete from forms where guild_id in ($1, $2)', [G3, G4]);
  await pool.query('drop trigger forms_assign_number on forms');
  await pool.query('alter table forms drop constraint forms_number_check');
  await pool.query('drop index idx_forms_guild_number');
  await pool.query('alter table forms alter column number drop not null');
  const old = [[G3, 'first'], [G4, 'x-first'], [G3, 'second'], [G4, 'x-second'], [G3, 'third'], [G3, 'fourth'], [G4, 'x-third']];
  for (const [guild, name] of old) await pool.query("insert into forms (guild_id, name, title) values ($1, $2, $2)", [guild, name]);
  await pool.query("delete from forms where name = 'second'"); // a hole in the creation order is closed
  const { rows: before } = await pool.query('select count(*) filter (where number is null)::int as empty from forms where guild_id in ($1, $2)', [G3, G4]);
  assert.equal(before[0].empty, 6, 'the old rows have no number');
  await pool.query(schema);
  const numbered = async (guild) => (await pool.query('select name, number from forms where guild_id = $1 order by number', [guild])).rows.map((r) => `${r.name}:${r.number}`);
  assert.deepEqual(await numbered(G3), ['first:1', 'third:2', 'fourth:3'], 'numbered per server in creation order');
  assert.deepEqual(await numbered(G4), ['x-first:1', 'x-second:2', 'x-third:3'], 'each server starts at 1');
  await pool.query(schema);
  assert.deepEqual(await numbered(G3), ['first:1', 'third:2', 'fourth:3'], 'applying the schema again changes nothing');
  assert.equal((await formsDb.createForm(G3, forms.normalizeForm({ name: 'fifth', title: 'x' }))).number, 4, 'new forms continue after the migrated ones');
  const { rows: [cols] } = await pool.query("select is_nullable from information_schema.columns where table_name = 'forms' and column_name = 'number'");
  assert.equal(cols.is_nullable, 'NO', 'the number is required after the migration');
  // A table with some numbers already (a run that stopped halfway): the empty ones continue after the highest.
  await pool.query('drop trigger forms_assign_number on forms'); await pool.query('alter table forms alter column number drop not null');
  await pool.query("insert into forms (guild_id, name, title) values ($1, 'late', 'late')", [G3]);
  await pool.query(schema);
  assert.deepEqual(await numbered(G3), ['first:1', 'third:2', 'fourth:3', 'fifth:4', 'late:5']);
  // The migration file kept for a database that is migrated by hand does the same, twice.
  const migration = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '2026-11-01-per-server-form-numbers.sql'), 'utf8');
  await pool.query(migration); await pool.query(migration);
  assert.deepEqual(await numbered(G3), ['first:1', 'third:2', 'fourth:3', 'fifth:4', 'late:5'], 'the one-time migration is a no-op on a numbered table');
  assert.equal((await formsDb.createForm(G4, forms.normalizeForm({ name: 'x-fourth', title: 'x' }))).number, 4);
  await pool.query('delete from schema_migrations where name = $1', ['2026-11-01-per-server-form-numbers']);

  // Appeal forms (the public appeal site) are numbered per server the same way: the number is what is in the address of a form.
  await pool.query('delete from appeal_forms where guild_id in ($1, $2)', [G3, G4]);
  const af = async (guild, name) => (await pool.query("insert into appeal_forms (guild_id, name) values ($1, $2) returning id, number", [guild, name])).rows[0];
  const [a1, b1, a2, b2, a3] = [await af(G3, 'one'), await af(G4, 'uno'), await af(G3, 'two'), await af(G4, 'dos'), await af(G3, 'three')];
  assert.deepEqual([a1.number, a2.number, a3.number, b1.number, b2.number], [1, 2, 3, 1, 2], 'appeal forms are numbered per server');
  assert.equal((await appealsDb.getFormByNumber(G3, 2)).id, a2.id); assert.equal((await appealsDb.getFormByNumber(G4, 2)).id, b2.id, 'number 2 is each server\'s own');
  assert.equal(await appealsDb.getFormByNumber(G4, 3), null); assert.equal(await appealsDb.getFormByNumber(G3, 'x'), null); assert.equal(await appealsDb.getFormByNumber(G3, 0), null);
  assert.equal((await appealsDb.findForm(G3, { number: '3' })).id, a3.id, 'by number'); assert.equal((await appealsDb.findForm(G3, { id: a1.id })).number, 1, 'the internal id the site sent before still works');
  assert.equal(await appealsDb.findForm(G4, { id: a1.id }), null, 'an internal id of another server finds nothing'); assert.equal(await appealsDb.findForm(G3, {}), null);
  assert.equal(await appealsDb.findForm(G4, { number: a3.number, id: a1.id }), null, 'the number wins when both come');
  await pool.query('delete from appeal_forms where id = $1', [a3.id]);
  assert.equal((await af(G3, 'four')).number, 3, 'the highest number of a server is free again after its form is deleted');
  // The old table (no numbers) is numbered once, in creation order, by the schema.
  await pool.query('drop trigger appeal_forms_assign_number on appeal_forms'); await pool.query('alter table appeal_forms alter column number drop not null'); await pool.query('drop index idx_appeal_forms_guild_number');
  await pool.query('delete from appeal_forms where guild_id in ($1, $2)', [G3, G4]);
  for (const [g, n] of [[G3, 'p'], [G4, 'q'], [G3, 'r']]) await pool.query('insert into appeal_forms (guild_id, name) values ($1, $2)', [g, n]);
  await pool.query(schema); await pool.query(schema);
  assert.deepEqual((await pool.query('select name, number from appeal_forms where guild_id in ($1, $2) order by guild_id, number', [G3, G4])).rows.map((r) => `${r.name}:${r.number}`), ['p:1', 'r:2', 'q:1'], 'appeal forms already in the database are numbered per server in creation order');
  await pool.query('delete from appeal_forms where guild_id in ($1, $2)', [G3, G4]);

  await pool.query('delete from guilds where guild_id in ($1, $2, $3, $4)', [G1, G2, G3, G4]);
  await closePools();
  console.log('Checked the forms tables against a real database: numbers of forms and submissions, the migration, reviews, retention and the cap.');
})().catch((error) => { console.error(error); process.exit(1); });
