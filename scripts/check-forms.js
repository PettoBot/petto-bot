// Checks forms (applications): what a form and its questions may hold, who may open a form, the pages of five questions with
// "Next" between them, the review card (long answers go in a file), accepting and denying with the roles they give and take, the
// DM, who may review, the panel, and the `!form` command (its limits, settings and questions). Discord and the database are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, ComponentType, MessageFlags, PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/database.js', { from() { throw new Error('the database is not used in this check'); } });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {}, debug() {} });
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });
const templates = new Map();
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => templates.get(name) ?? null });
stub('src/utils/templatedMessage.js', { templatePayload: async (guildId, name) => (templates.has(name) ? { content: undefined, embeds: [{ title: name }], components: [], files: [], reactions: [] } : null) });
stub('src/utils/embedVariables.js', { resolve: async (text, ctx) => String(text).replace(/\{user\}/g, ctx.user ? `<@${ctx.user.id}>` : '') });
const logs = [];
stub('src/logging/engine.js', { sendLog: async (client, guildId, event, embed) => { logs.push({ event, embed }); } });

// The database: one in-memory copy with the same rules (names per server, numbers per server, a review only of what is pending).
const db = { forms: [], subs: [], panels: [], nextForm: 1, nextPanel: 1 };
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const copy = (row) => (row ? JSON.parse(JSON.stringify(row)) : null);
stub('src/db/forms.js', {
  NAME,
  listForms: async (g) => db.forms.filter((f) => f.guild_id === g).map(copy),
  getFormByPublicId: async (id) => (/^[0-9A-Za-z]{12}$/.test(String(id ?? '')) ? copy(db.forms.find((f) => f.public_id === String(id))) : null),
  renewPublicId: async (g, id) => { const f = db.forms.find((x) => x.guild_id === g && x.id === Number(id)); if (!f) return null; f.public_id = require('../src/utils/forms').newPublicId(); return copy(f); },
  getForm: async (g, ref) => {
    const text = String(ref ?? '').toLowerCase();
    const row = /^\d+$/.test(text) ? db.forms.find((f) => f.guild_id === g && f.id === Number(text)) : db.forms.find((f) => f.guild_id === g && f.name === text);
    return copy(row);
  },
  countForms: async (g) => db.forms.filter((f) => f.guild_id === g).length,
  createForm: async (g, row) => { if (db.forms.some((f) => f.guild_id === g && f.name === row.name)) throw Object.assign(new Error('dup'), { code: '23505' }); const f = { ...copy(row), id: db.nextForm++, guild_id: g }; db.forms.push(f); return copy(f); },
  updateForm: async (g, id, changes) => { const f = db.forms.find((x) => x.guild_id === g && x.id === Number(id)); if (!f) return null; Object.assign(f, copy(changes)); return copy(f); },
  deleteForm: async (g, id) => { db.forms = db.forms.filter((f) => !(f.guild_id === g && f.id === Number(id))); for (const s of db.subs) if (s.form_id === Number(id)) s.form_id = null; },
  createSubmission: async (row) => { const number = db.subs.filter((s) => s.guild_id === row.guild_id).length + 1; const s = { ...copy(row), number, status: 'pending', created_at: new Date().toISOString(), role_changes: {}, reviewed_at: null, reason: null, thread_id: null }; db.subs.push(s); return copy(s); },
  getSubmission: async (g, n) => copy(db.subs.find((s) => s.guild_id === g && s.number === Number(n))),
  updateSubmission: async (g, n, changes) => { const s = db.subs.find((x) => x.guild_id === g && x.number === Number(n)); if (!s) return null; Object.assign(s, copy(changes)); return copy(s); },
  resolveSubmission: async (g, n, changes) => { const s = db.subs.find((x) => x.guild_id === g && x.number === Number(n) && x.status === 'pending'); if (!s) return null; Object.assign(s, copy(changes)); return copy(s); },
  listSubmissions: async (g, { formId = null, status = null, userId = null, limit = 25 } = {}) => db.subs.filter((s) => s.guild_id === g && (!formId || s.form_id === Number(formId)) && (!status || s.status === status) && (!userId || s.user_id === userId)).reverse().slice(0, limit).map(copy),
  memberStats: async (g, formId, userId) => {
    const rows = db.subs.filter((s) => s.guild_id === g && s.form_id === Number(formId) && s.user_id === userId);
    const denied = [...rows].reverse().find((s) => s.status === 'denied');
    return { pending: rows.filter((s) => s.status === 'pending').length, total: rows.filter((s) => s.status !== 'cancelled').length, lastDeniedAt: denied ? denied.reviewed_at : null };
  },
  countFormSubmissions: async (g, formId) => db.subs.filter((s) => s.guild_id === g && s.form_id === Number(formId) && s.status !== 'cancelled').length,
  countStored: async (g) => ({ total: db.subs.filter((s) => s.guild_id === g).length, pending: db.subs.filter((s) => s.guild_id === g && s.status === 'pending').length }),
  trimOldest: async (g, keep) => { const mine = db.subs.filter((s) => s.guild_id === g); const extra = mine.length - keep; const old = mine.filter((s) => s.status !== 'pending').slice(0, Math.max(0, extra)); db.subs = db.subs.filter((s) => !old.includes(s)); return old.length; },
  getFormConfig: async () => ({ retention_days: db.retention ?? 30 }),
  setFormConfig: async (g, changes) => { db.retention = changes.retention_days; return { retention_days: db.retention }; },
  createPanel: async (g, row) => { const p = { ...copy(row), id: db.nextPanel++, guild_id: g }; db.panels.push(p); return copy(p); },
  updatePanel: async (g, id, changes) => { const p = db.panels.find((x) => x.id === Number(id)); Object.assign(p, changes); return copy(p); },
  getPanel: async (g, id) => copy(db.panels.find((x) => x.id === Number(id))),
  listPanels: async () => db.panels.map(copy),
  deletePanel: async (g, id) => { db.panels = db.panels.filter((x) => x.id !== Number(id)); },
});

const i18n = require('../src/i18n');
i18n.setCachedGuildLanguage?.('g1', 'en');
const forms = require('../src/utils/forms');
const cards = require('../src/utils/formCards');
const actions = require('../src/utils/formActions');
const { handleFormInteraction } = require('../src/interactions/forms');
const formCommand = require('../src/commands/automation/form');

// ---- Discord, made up.
const DAY = 86_400_000;
const role = (id, position, extra = {}) => ({ id, position, managed: false, name: id, ...extra });
const roles = new Collection([['g1', role('g1', 0)], ['member', role('member', 5)], ['staff', role('staff', 10)], ['trial', role('trial', 9)], ['applicant', role('applicant', 4)], ['banned', role('banned', 3)], ['reviewer', role('reviewer', 12)], ['top', role('top', 99)], ['app', role('app', 6, { managed: true })]]);
const members = new Collection();
function makeMember(id, { roleIds = [], permissions = [], age = 400, joined = 100 } = {}) {
  const cache = new Collection(roleIds.map((r) => [r, roles.get(r)]));
  const member = {
    id, displayName: `Name ${id}`, joinedTimestamp: Date.now() - joined * DAY,
    user: { id, username: `user_${id}`, createdTimestamp: Date.now() - age * DAY, displayAvatarURL: () => `https://cdn.example/${id}.png` },
    roles: { cache, add: async (r) => { cache.set(r.id, r); }, remove: async (r) => { cache.delete(r.id); } },
    permissions: { has: (flag) => permissions.includes(flag) },
  };
  members.set(id, member);
  return member;
}
const sent = []; const edits = []; const threads = [];
const reviewMessage = (n) => ({ id: `msg${n}`, url: `https://discord.com/channels/g1/review/msg${n}`, attachments: new Collection(), edit: async (p) => { edits.push(p); }, startThread: async ({ name }) => { const th = { id: `th${n}`, name }; threads.push(th); return th; } });
const reviewChannel = { id: 'review', isTextBased: () => true, send: async (payload) => { sent.push(payload); return reviewMessage(sent.length); }, messages: { fetch: async (id) => reviewMessage(Number(String(id).replace('msg', ''))) }, permissionsFor: () => ({ has: () => true }) };
const panels = [];
const panelChannel = { id: 'panels', isTextBased: () => true, send: async (payload) => { panels.push(payload); return { id: `p${panels.length}`, url: `https://discord.com/channels/g1/panels/p${panels.length}` }; }, permissionsFor: () => ({ has: () => true }) };
const channels = new Collection([['review', reviewChannel], ['panels', panelChannel]]);
const me = { roles: { highest: { position: 50 } }, permissions: { has: () => true } };
const guild = { id: 'g1', name: 'Mine', roles: { cache: roles }, members: { me, cache: members, fetch: async (id) => members.get(id) ?? Promise.reject(new Error('Unknown Member')) }, channels: { cache: channels, fetch: async (id) => channels.get(id) ?? null } };
const dms = [];
let dmOpen = true;
const client = { users: { fetch: async (id) => ({ id, send: async (p) => { if (!dmOpen) throw new Error('Cannot send'); dms.push({ id, p }); } }) } };
guild.client = client;

const textOf = (payload) => JSON.stringify(payload);
const fieldsOf = (values) => ({
  getTextInputValue: (id) => { if (!(id in values)) throw new Error('no field'); return values[id]; },
  getStringSelectValues: (id) => { if (!(id in values)) throw new Error('no field'); return values[id]; },
});

(async () => {
  // ---- The rules of a question and a form.
  const q = forms.normalizeQuestion({ type: 'short', label: 'x'.repeat(80), help: 'h'.repeat(150), min_length: 900, max_length: 50 }, 0);
  assert.equal(q.label.length, 45, 'a label fits the 45 characters of Discord'); assert.equal(q.help.length, 100); assert.equal(q.max_length, 50); assert.equal(q.min_length, 50, 'the least is never more than the most');
  assert.equal(forms.normalizeQuestion({ type: 'choice', label: 'Pick', options: ['only'] }), null, 'a choice needs two options');
  assert.equal(forms.normalizeQuestion({ type: 'short', label: '   ' }), null, 'a question needs a text');
  const choice = forms.normalizeQuestion({ type: 'multi', label: 'Days', options: 'Mon|Tue|Tue|Wed', max_choices: 9 });
  assert.deepEqual(choice.options, ['Mon', 'Tue', 'Wed'], 'options are cleaned and unique'); assert.equal(choice.max_choices, 3);
  const num = forms.normalizeQuestion({ type: 'number', label: 'Age', min_value: 99, max_value: 13 });
  assert.deepEqual([num.min_value, num.max_value], [13, 99], 'a range written backwards is turned around');
  assert.equal(forms.normalizeQuestion({ type: 'weird', label: 'X' }).type, 'short', 'an unknown type is a short answer');
  const many = forms.normalizeQuestions(Array.from({ length: 40 }, (_, i) => ({ id: 'same', type: 'short', label: `Q${i}` })));
  assert.equal(many.length, 25, 'at most 25 questions'); assert.equal(new Set(many.map((x) => x.id)).size, 25, 'question ids are unique');
  const normal = forms.normalizeForm({ name: 'Staff Apps!', title: 'Staff application for the best server ever made', status: 'open', reviewer_role_ids: ['123456789012345678', 'nope'], min_account_days: 99999, color: 0x1000000, button_style: 'weird', messages: { accepted: { text: ' Welcome {user} ', template: '' } } });
  assert.equal(normal.name, 'staff-apps'); assert.equal(normal.title.length, 45); assert.deepEqual(normal.reviewer_role_ids, ['123456789012345678']);
  assert.equal(normal.min_account_days, 3650); assert.equal(normal.color, null); assert.equal(normal.button_style, 'primary'); assert.deepEqual(normal.messages.accepted, { text: 'Welcome {user}' });
  assert.equal(forms.slugName('  Événement 2026 '), 'evenement-2026');
  // A description (longer, with lines and simple marks, for the web) and an image over the question (only on the web).
  const described = forms.normalizeQuestion({ type: 'short', label: 'Why', description: `  Tell us **why**.\r\n\n\n\nSee [the rules](https://petto.sbs/rules).${'x'.repeat(1200)}`, image: 'https://i.imgur.com/abc.PNG?size=2' });
  assert.equal(described.description.length, 1000, 'a description keeps 1000 characters'); assert.match(described.description, /^Tell us \*\*why\*\*\.\n\nSee/, 'lines are kept, at most one empty line in a row');
  assert.equal(described.image, 'https://i.imgur.com/abc.PNG?size=2'); assert.equal(described.help, null);
  for (const bad of ['http://i.imgur.com/a.png', 'https://i.imgur.com/a.svg', 'https://i.imgur.com/page', 'https://user:pw@i.imgur.com/a.png', 'https://127.0.0.1/a.png', 'https://10.0.0.2/a.gif', 'https://i.imgur.com:8443/a.png', 'javascript:alert(1)//a.png', `https://i.imgur.com/${'a'.repeat(500)}.png`, 'not a link']) {
    assert.equal(forms.normalizeQuestion({ type: 'short', label: 'X', image: bad }).image, null, `no image from ${bad.slice(0, 40)}`);
  }
  for (const good of ['https://cdn.discordapp.com/attachments/1/2/a.jpeg?ex=1', 'https://x.example/b.webp', 'https://x.example/c.gif', 'https://x.example/d.jpg']) assert.equal(forms.imageUrl(good), good);
  assert.equal(forms.normalizeQuestion({ type: 'short', label: 'X' }).description, null);
  assert.equal(forms.labelDescription({ help: 'Short help', description: 'Long' }), 'Short help', 'Discord shows the help line first');
  assert.equal(forms.labelDescription({ help: null, description: 'Read **the rules** in [our site](https://petto.sbs).\nThen answer.' }), 'Read the rules in our site. Then answer.', 'or the description, as plain text');
  const cut = forms.labelDescription({ description: 'word '.repeat(60) });
  assert.equal(cut.length, 100); assert.ok(cut.endsWith('…'));
  assert.equal(forms.labelDescription({ help: null, description: null }), null);
  const descModal = forms.buildModal({ id: 7, title: 'T', questions: [described, { type: 'short', label: 'Plain' }] }, 0).toJSON();
  assert.equal(descModal.components[0].description, 'Tell us why. See the rules.' + 'x'.repeat(72) + '…', 'the label of the Discord form gets the start of the description');
  assert.equal(descModal.components[1].description, undefined);

  // ---- Who may open a form.
  const base = { status: 'open', questions: [{ id: 'q1', type: 'short', label: 'Name' }], one_pending: true, required_role_ids: [], blocked_role_ids: [], min_account_days: 0, min_member_days: 0, deny_cooldown_hours: 0, max_per_user: 0, max_total: 0 };
  const plain = makeMember('u1', { roleIds: ['member'] });
  const code = (form, member = plain, stats = {}, opts = {}) => forms.checkEligibility({ ...base, ...form }, member, stats, opts)?.code ?? 'ok';
  assert.equal(code({}), 'ok');
  assert.equal(code({ status: 'closed' }), 'closed');
  assert.equal(code({ closes_at: new Date(Date.now() - 1000).toISOString() }), 'ended');
  assert.equal(code({ closes_at: new Date(Date.now() + DAY).toISOString() }), 'ok');
  assert.equal(code({ questions: [] }), 'empty');
  assert.equal(code({ max_total: 3 }, plain, {}, { total: 3 }), 'full');
  assert.equal(code({ blocked_role_ids: ['member'] }), 'blocked');
  assert.equal(code({ required_role_ids: ['staff', 'trial'] }), 'roles'); assert.equal(code({ required_role_ids: ['staff', 'member'] }), 'ok', 'one of the required roles is enough');
  assert.equal(code({ min_account_days: 30 }, makeMember('young', { age: 3 })), 'account');
  assert.equal(code({ min_member_days: 7 }, makeMember('new', { joined: 1 })), 'member');
  assert.equal(code({}, plain, { pending: 1 }), 'pending'); assert.equal(code({ one_pending: false }, plain, { pending: 1 }), 'ok');
  assert.equal(code({ max_per_user: 2 }, plain, { total: 2 }), 'limit');
  assert.equal(code({ deny_cooldown_hours: 24 }, plain, { lastDeniedAt: new Date(Date.now() - 3_600_000).toISOString() }), 'cooldown');
  assert.equal(code({ deny_cooldown_hours: 24 }, plain, { lastDeniedAt: new Date(Date.now() - 2 * DAY).toISOString() }), 'ok');
  assert.match(forms.refusalText(forms.checkEligibility({ ...base, required_role_ids: ['staff'] }, plain, {}), 'es'), /Necesitas uno de estos roles[\s\S]*<@&staff>/);

  // ---- Who may review.
  const admin = makeMember('admin', { permissions: [PermissionFlagsBits.ManageGuild] });
  const reviewer = makeMember('rev', { roleIds: ['reviewer'] });
  assert.equal(forms.isReviewer(admin, { reviewer_role_ids: [] }), true, 'who manages the server reviews every form');
  assert.equal(forms.isReviewer(reviewer, { reviewer_role_ids: ['reviewer'] }), true);
  assert.equal(forms.isReviewer(reviewer, { reviewer_role_ids: [] }), false, 'a role only counts on the forms that name it');
  assert.equal(forms.isReviewer(plain, null), false);

  // ---- Pages: 12 questions are 3 Discord forms (5, 5, 2), with menus for the choices.
  const twelve = { ...base, id: 7, title: 'Staff application for the server', questions: [
    { id: 'name', type: 'short', label: 'Your name', placeholder: 'Liam', max_length: 40 },
    { id: 'age', type: 'number', label: 'Your age', min_value: 13, max_value: 99 },
    { id: 'why', type: 'paragraph', label: 'Why you?', min_length: 10, max_length: 1500 },
    { id: 'mic', type: 'yesno', label: 'Do you have a mic?' },
    { id: 'tz', type: 'choice', label: 'Timezone', options: ['UTC', 'GMT-3', 'GMT+1'] },
    { id: 'days', type: 'multi', label: 'Days', options: ['Mon', 'Tue', 'Wed'], max_choices: 2, required: false },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, type: 'short', label: `Extra ${i}`, required: false })),
  ] };
  assert.deepEqual(forms.pagesOf(twelve).map((p) => p.length), [5, 5, 2]);
  const modal = forms.buildModal(twelve, 0).toJSON();
  assert.equal(modal.custom_id, 'fm:p:7:0'); assert.ok(modal.title.endsWith(' (1/3)') && modal.title.length <= 45, 'the title says the page and fits');
  assert.equal(modal.components.length, 5);
  assert.ok(modal.components.every((c) => c.type === ComponentType.Label), 'every question is a label');
  const inner = modal.components.map((c) => c.component);
  assert.equal(inner[0].type, ComponentType.TextInput); assert.equal(inner[0].max_length, 40); assert.equal(inner[0].placeholder, 'Liam');
  assert.equal(inner[1].placeholder, '13 – 99', 'a number shows its range');
  assert.equal(inner[2].min_length, 10);
  assert.equal(inner[3].type, ComponentType.StringSelect); assert.deepEqual(inner[3].options.map((o) => o.value), ['yes', 'no']);
  assert.equal(inner[4].max_values, 1); assert.deepEqual(inner[4].options.map((o) => o.label), ['UTC', 'GMT-3', 'GMT+1']);
  const page2 = forms.buildModal(twelve, 1, { values: { days: ['o0'], x0: 'kept' } }).toJSON();
  assert.equal(page2.components[0].component.max_values, 2); assert.equal(page2.components[0].component.min_values, 0, 'an optional menu can stay empty');
  assert.equal(page2.components[0].component.options[0].default, true, 'a page shown again keeps what was picked'); assert.equal(page2.components[1].component.value, 'kept');

  // Reading a page: numbers are checked, menus become the text of their option.
  let read = forms.readPage(twelve, 0, fieldsOf({ a_name: ' Liam ', a_age: 'ten', a_why: 'Because I like helping', a_mic: ['yes'], a_tz: ['o1'] }));
  assert.deepEqual(read.errors.map((e) => [e.id, e.code]), [['age', 'number']]);
  read = forms.readPage(twelve, 0, fieldsOf({ a_name: 'Liam', a_age: '120', a_why: 'Because I like helping', a_mic: ['yes'], a_tz: ['o1'] }));
  assert.deepEqual(read.errors.map((e) => e.code), ['range']);
  read = forms.readPage(twelve, 0, fieldsOf({ a_name: 'Liam', a_age: '17', a_why: 'Because I like helping', a_mic: ['yes'], a_tz: ['o9'] }));
  assert.deepEqual(read.errors.map((e) => e.code), ['required'], 'an option that does not exist is no answer');
  read = forms.readPage(twelve, 0, fieldsOf({ a_name: 'Liam', a_age: '17,5', a_why: 'Because I like helping', a_mic: ['no'], a_tz: ['o2'] }));
  assert.deepEqual(read.errors, []);
  const answers = forms.collectAnswers(twelve, { ...read.values, days: ['o0', 'o2'] });
  assert.equal(answers.find((a) => a.id === 'tz').value, 'GMT+1'); assert.deepEqual(answers.find((a) => a.id === 'days').value, ['Mon', 'Wed']); assert.equal(answers.find((a) => a.id === 'mic').value, 'no');
  assert.deepEqual(forms.missingRequired(twelve, answers), [], 'the optional extras can stay empty');
  assert.equal(forms.answerText({ type: 'yesno', value: 'yes' }, 'pt-BR'), 'Sim');

  // ---- The review card: long answers are cut and go whole in a file; the card stays under Discord's limit.
  const long = { number: 3, guild_id: 'g1', user_id: 'u1', username: 'liam', form_name: 'staff', form_title: 'Staff', status: 'pending', avatar_url: 'https://cdn.example/u1.png', answers: Array.from({ length: 25 }, (_, i) => ({ id: `q${i}`, label: `Question ${i}`, type: 'paragraph', value: 'word '.repeat(800) })) };
  const built = cards.reviewCard({ submission: long, form: null });
  const json = built.container.toJSON();
  const text = JSON.stringify(json).length;
  const shown = json.components.filter((c) => c.type === ComponentType.TextDisplay).map((c) => c.content).join('');
  assert.ok(shown.length < 4000, `the text of the card fits (${shown.length})`); assert.ok(text > 0);
  assert.equal(built.file?.name, 'answers-3.txt'); assert.ok(json.components.some((c) => c.type === ComponentType.File), 'the card points at the file');
  const short = cards.reviewCard({ submission: { ...long, answers: long.answers.slice(0, 3).map((a) => ({ ...a, value: 'short' })) } });
  assert.equal(short.file, null, 'answers that fit need no file');
  const buttons = (container) => container.toJSON().components.at(-1).components;
  assert.deepEqual(buttons(short.container).slice(0, 3).map((b) => b.custom_id), ['fm:a:3', 'fm:d:3', 'fm:t:3']);
  assert.equal(buttons(cards.reviewCard({ submission: { ...long, status: 'accepted', reviewer_id: 'rev', reviewed_at: new Date().toISOString() } }).container)[0].disabled, true, 'an answered card is locked');
  assert.match(forms.answersAsText(long), /Staff · submission #3 · liam \(u1\)[\s\S]*Question 24/);

  // ---- A form made with `!form`: limits, settings, questions.
  const talk = async (sub, values = {}, who = admin, group = null) => {
    const out = [];
    const pick = (name) => (name in values ? values[name] : null);
    const interaction = {
      guild, user: who.user, member: who, client, channel: { id: 'here' },
      options: { getSubcommand: () => sub, getSubcommandGroup: () => group, getString: pick, getBoolean: pick, getRole: pick, getChannel: pick, getInteger: pick, getNumber: pick },
      deferReply: async () => {}, editReply: async (payload) => { out.push(textOf(payload)); },
    };
    await formCommand.execute(interaction);
    return out.join('\n');
  };
  assert.match(await talk('create', { name: 'staff' }, plain), /Manage Server/, 'only managers make forms');
  assert.match(await talk('create', { name: 'Staff', title: 'Staff application' }), /Form `staff` made/);
  assert.match(await talk('create', { name: 'staff' }), /already a form called `staff`/);
  // One limit for every server, never a Premium one (made small here so the check stays short).
  assert.deepEqual(require('../src/utils/forms').FORM_LIMITS, { forms: 25, questions: 25, submissions: 2000 });
  require('../src/utils/forms').FORM_LIMITS.forms = 5;
  for (const n of ['a', 'b', 'c', 'd']) await talk('create', { name: n });
  const full = await talk('create', { name: 'e' });
  assert.match(full, /most forms it can have \(5\)/); assert.doesNotMatch(full, /Premium|free/i, 'forms never mention Premium');
  require('../src/utils/forms').FORM_LIMITS.forms = 25;
  assert.match(await talk('create', { name: 'e' }), /made/);
  assert.match(await talk('open', { form: 'staff' }), /cannot be opened yet[\s\S]*question add[\s\S]*channel/, 'a form opens only with questions and a channel');
  assert.match(await talk('add', { form: 'staff', type: 'choice', label: 'Team', options: 'Only' }, admin, 'question'), /at least 2 options/);
  assert.match(await talk('add', { form: 'staff', type: 'short', label: 'Your name', placeholder: 'Liam', max: 40 }, admin, 'question'), /Question 1 added/);
  assert.match(await talk('add', { form: 'staff', type: 'number', label: 'Your age', min: 13, max: 99 }, admin, 'question'), /Question 2 added/);
  assert.match(await talk('add', { form: 'staff', type: 'choice', label: 'Team', options: 'Mod|Events|Support' }, admin, 'question'), /Question 3 added/);
  assert.match(await talk('move', { form: 'staff', from: 3, to: 1 }, admin, 'question'), /Team\*\* is now question 1/);
  assert.match(await talk('edit', { form: 'staff', position: 2, field: 'required', value: 'no' }, admin, 'question'), /Question 2 changed/);
  assert.match(await talk('edit', { form: 'staff', position: 9, field: 'label', value: 'x' }, admin, 'question'), /from 1 to 3/);
  assert.match(await talk('questions', { form: 'staff' }), /1\.\*\* Team[\s\S]*2\.\*\* Your name[\s\S]*optional[\s\S]*3\.\*\* Your age/);
  assert.match(await talk('edit', { form: 'staff', position: 1, field: 'description', value: 'Pick the **team** you like.\nYou can change later.' }, admin, 'question'), /Question 1 changed/);
  assert.match(await talk('edit', { form: 'staff', position: 1, field: 'image', value: 'http://example.com/a.png' }, admin, 'question'), /https link to a \.png/, 'an image link is checked');
  assert.match(await talk('edit', { form: 'staff', position: 1, field: 'image', value: 'https://i.imgur.com/team.png' }, admin, 'question'), /Question 1 changed/);
  assert.match(await talk('questions', { form: 'staff' }), /Team[\s\S]*Description: Pick the team you like\. You can change later\.[\s\S]*Image: i\.imgur\.com/, '!form questions shows the description and the image');
  assert.match(await talk('add', { form: 'staff', type: 'short', label: 'Bad image', image: 'https://i.imgur.com/a.txt' }, admin, 'question'), /https link/);
  const staffForm = () => db.forms.find((f) => f.name === 'staff');
  assert.equal(staffForm().questions[1].required, false);
  require('../src/utils/forms').FORM_LIMITS.questions = 10;
  for (let i = 0; i < 7; i += 1) await talk('add', { form: 'staff', type: 'short', label: `Extra ${i}` }, admin, 'question');
  assert.match(await talk('add', { form: 'staff', type: 'short', label: 'One too many' }, admin, 'question'), /most questions it can have \(10\)/);
  require('../src/utils/forms').FORM_LIMITS.questions = 25;
  assert.match(await talk('remove', { form: 'staff', position: 10 }, admin, 'question'), /removed/);
  assert.match(await talk('set', { form: 'staff', setting: 'channel', value: '#review' }), /saved/); assert.equal(staffForm().review_channel_id, 'review');
  assert.match(await talk('set', { form: 'staff', setting: 'accept-roles', value: 'staff, trial' }), /saved/); assert.deepEqual(staffForm().accept_add_role_ids, ['staff', 'trial']);
  await talk('set', { form: 'staff', setting: 'accept-remove-roles', value: 'applicant' });
  await talk('set', { form: 'staff', setting: 'deny-roles', value: 'banned top app' });
  await talk('set', { form: 'staff', setting: 'reviewers', value: 'reviewer' });
  await talk('set', { form: 'staff', setting: 'cooldown', value: '2d' }); assert.equal(staffForm().deny_cooldown_hours, 48, '2d is 48 hours');
  await talk('set', { form: 'staff', setting: 'account-age', value: '7' }); assert.equal(staffForm().min_account_days, 7);
  assert.match(await talk('set', { form: 'staff', setting: 'blocked-roles', value: 'nosuchrole' }), /were not found: nosuchrole/);
  assert.match(await talk('set', { form: 'staff', setting: 'color', value: 'blue' }), /#5865f2/);
  assert.match(await talk('set', { form: 'staff', setting: 'closes', value: 'yesterday' }), /when it closes/);
  await talk('set', { form: 'staff', setting: 'closes', value: '30d' }); assert.ok(Date.parse(staffForm().closes_at) > Date.now() + 29 * DAY);
  await talk('set', { form: 'staff', setting: 'closes', value: 'none' }); assert.equal(staffForm().closes_at, null);
  assert.match(await talk('message', { form: 'staff', kind: 'accepted', text: 'Welcome to the team {user}! #{number} {reason}' }), /Message saved/);
  assert.match(await talk('message', { form: 'staff', kind: 'denied', template: 'nope' }), /no saved embed called `nope`/);
  assert.match(await talk('open', { form: 'staff' }), /is open/); assert.equal(staffForm().status, 'open');
  assert.match(await talk('info', { form: 'staff' }), /Staff application[\s\S]*<#review>[\s\S]*<@&reviewer>[\s\S]*gives <@&staff> <@&trial>[\s\S]*9 questions in 2 pages/);
  assert.match(await talk('list', {}), /Forms \(6\/25\)[\s\S]*`staff` · \*\*Staff application\*\* · open · 9 questions/);
  assert.equal(formCommand.prefixOnly, true, '!form is a prefix command, never a slash command');

  // ---- A member fills the form in from the panel: two pages with "Next" between them.
  const id = staffForm().id;
  const shownModals = []; const replies = [];
  const interaction = (customId, kind, extra = {}) => ({
    customId, guild, guildId: 'g1', client, member: extra.member ?? plain, user: (extra.member ?? plain).user,
    isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select', isModalSubmit: () => kind === 'modal',
    isFromMessage: () => Boolean(extra.ephemeralMessage), message: extra.ephemeralMessage ? { flags: { has: (f) => f === MessageFlags.Ephemeral } } : { flags: { has: () => false } },
    values: extra.values, fields: extra.fields,
    deferred: false, replied: false,
    showModal: async (m) => { shownModals.push(m.toJSON()); },
    reply: async function (p) { this.replied = true; replies.push(p); },
    update: async (p) => { replies.push({ updated: true, ...p }); },
    deferReply: async function () { this.deferred = true; }, deferUpdate: async function () { this.deferred = true; },
    editReply: async (p) => { replies.push(p); },
  });
  await handleFormInteraction(interaction(`fm:o:${id}`, 'button', { member: makeMember('young2', { age: 2 }) }));
  assert.match(textOf(replies.at(-1)), /at least 7 days old/, 'the rules are checked before the form opens'); assert.equal(shownModals.length, 0);
  await handleFormInteraction(interaction(`fm:o:${id}`, 'button'));
  assert.equal(shownModals.at(-1).custom_id, `fm:p:${id}:0`); assert.equal(shownModals.at(-1).components.length, 5);
  await handleFormInteraction(interaction(`fm:p:${id}:0`, 'modal', { fields: fieldsOf({ a_q3: [], [`a_${staffForm().questions[0].id}`]: ['o0'], [`a_${staffForm().questions[1].id}`]: 'Liam', [`a_${staffForm().questions[2].id}`]: 'old', a_x: '' }) }));
  assert.match(textOf(replies.at(-1)), /need a fix[\s\S]*Your age[\s\S]*write a number/, 'a wrong answer is offered again');
  assert.match(textOf(replies.at(-1)), /fm:n:\d+:0/);
  const firstPage = Object.fromEntries(staffForm().questions.slice(0, 5).map((qq) => [`a_${qq.id}`, qq.type === 'choice' ? ['o1'] : qq.type === 'number' ? '21' : 'answer']));
  await handleFormInteraction(interaction(`fm:p:${id}:0`, 'modal', { fields: fieldsOf(firstPage) }));
  assert.match(textOf(replies.at(-1)), /page 1 of 2 saved/); assert.match(textOf(replies.at(-1)), new RegExp(`fm:n:${id}:1`));
  await handleFormInteraction(interaction(`fm:n:${id}:1`, 'button', { ephemeralMessage: true }));
  assert.equal(shownModals.at(-1).custom_id, `fm:p:${id}:1`, 'Next opens the second page');
  const secondPage = Object.fromEntries(staffForm().questions.slice(5).map((qq) => [`a_${qq.id}`, 'more']));
  secondPage[`a_${staffForm().questions[5].id}`] = 'x'.repeat(30);
  await handleFormInteraction(interaction(`fm:p:${id}:1`, 'modal', { fields: fieldsOf(secondPage), ephemeralMessage: true }));
  assert.match(textOf(replies.at(-1)), /were sent \(#1\)/, 'the last page sends the whole form');
  assert.equal(db.subs.length, 1); assert.equal(db.subs[0].answers.length, 9); assert.equal(db.subs[0].answers[0].value, 'Events');
  assert.equal(sent.length, 1, 'the card goes to the review channel'); assert.equal(sent[0].flags, MessageFlags.IsComponentsV2);
  assert.equal(logs.at(-1).event, 'forms', 'the log hears about it');
  await handleFormInteraction(interaction(`fm:o:${id}`, 'button'));
  assert.match(textOf(replies.at(-1)), /waiting for the staff/, 'one pending submission at a time');

  // ---- The review: who may press, the roles, the DM, the card, a second press.
  makeMember('u1', { roleIds: ['member', 'applicant'] });
  await handleFormInteraction(interaction('fm:a:1', 'button'));
  assert.match(textOf(replies.at(-1)), /Only who manages the server or has a reviewer role/);
  await handleFormInteraction(interaction('fm:a:1', 'button', { member: reviewer }));
  assert.equal(shownModals.at(-1).custom_id, 'fm:ra:1', 'Accept asks for a reason');
  await handleFormInteraction(interaction('fm:ra:1', 'modal', { member: reviewer, fields: fieldsOf({ reason: 'Great answers' }) }));
  const accepted = db.subs[0];
  assert.equal(accepted.status, 'accepted'); assert.equal(accepted.reviewer_id, 'rev'); assert.equal(accepted.reason, 'Great answers');
  const u1 = members.get('u1');
  assert.ok(u1.roles.cache.has('staff') && u1.roles.cache.has('trial'), 'accepting gives the roles'); assert.ok(!u1.roles.cache.has('applicant'), 'and takes the others');
  assert.deepEqual(accepted.role_changes.added, ['staff', 'trial']); assert.deepEqual(accepted.role_changes.removed, ['applicant']);
  assert.match(textOf(dms.at(-1).p), /Welcome to the team <@u1>! #1 Great answers/, 'the DM uses the form text and its variables');
  assert.equal(edits.length >= 1, true, 'the card is redrawn'); assert.match(textOf(edits.at(-1)), /Accepted\*\* by <@rev>/);
  assert.match(textOf(replies.at(-1)), /Submission #1 of <@u1> accepted/);
  await handleFormInteraction(interaction('fm:d:1', 'button', { member: reviewer }));
  assert.match(textOf(replies.at(-1)), /already answered/, 'an answered submission cannot be answered again');
  assert.equal((await actions.reviewSubmission({ client, guild, submission: accepted, status: 'denied', reviewer: { id: 'admin', name: 'A' } })).error, 'already');

  // Denied: roles Petto cannot manage are reported, the member is told even with the default text, closed DMs are noted.
  db.forms.find((f) => f.name === 'staff').one_pending = true;
  const second = await actions.submitForm({ client, guild, form: staffForm(), member: members.get('u1'), answers: forms.collectAnswers(staffForm(), Object.fromEntries(staffForm().questions.map((qq) => [qq.id, qq.type === 'choice' ? 'o0' : qq.type === 'number' ? '20' : 'x']))) });
  assert.equal(second.ok, true);
  dmOpen = false;
  const denied = await actions.reviewSubmission({ client, guild, submission: second.submission, status: 'denied', reviewer: { id: 'admin', name: 'Admin' }, reason: 'Not now' });
  assert.equal(denied.ok, true); assert.deepEqual(denied.roles.added, ['banned']); assert.deepEqual(denied.roles.failed.sort(), ['app', 'top'], 'a role above Petto or managed by an app is not tried');
  assert.equal(denied.dm, false); assert.match(textOf(edits.at(-1)), /DMs closed/);
  dmOpen = true;
  const stats = await require('../src/db/forms').memberStats('g1', id, 'u1');
  assert.equal(forms.checkEligibility(staffForm(), members.get('u1'), stats)?.code, 'cooldown', 'after a denial the member waits');
  const gone = await actions.submitForm({ client, guild, form: staffForm(), member: members.get('u1'), answers: [] });
  assert.equal(gone.error, 'refused');

  // `!form` reviews too, with the same rules.
  db.forms.find((f) => f.name === 'staff').deny_cooldown_hours = 0;
  const third = await actions.submitForm({ client, guild, form: staffForm(), member: makeMember('u2', { roleIds: ['member'] }), answers: forms.collectAnswers(staffForm(), Object.fromEntries(staffForm().questions.map((qq) => [qq.id, qq.type === 'choice' ? 'o2' : qq.type === 'number' ? '30' : 'y']))) });
  assert.match(await talk('accept', { number: third.submission.number }, plain), /reviewer role/);
  assert.match(await talk('submissions', { form: 'pending' }, reviewer), /#3\*\* · <@u2>/, 'a state written where the form goes');
  assert.match(await talk('view', { number: 3 }, reviewer), /fm:a:3/);
  assert.match(await talk('deny', { number: 3, reason: 'Full team' }, reviewer), /#3 of <@u2> denied/);
  assert.match(await talk('submissions', { status: 'denied' }, admin), /#3[\s\S]*#2/);

  // Opening a thread under a card.
  await handleFormInteraction(interaction('fm:t:3', 'button', { member: reviewer }));
  assert.match(textOf(replies.at(-1)), /Thread opened: <#th3>/); assert.equal(db.subs[2].thread_id, 'th3');

  // ---- Panels: buttons, a menu, a saved embed.
  const formA = db.forms.find((f) => f.name === 'a');
  assert.match(await talk('panel', { channel: panelChannel, forms: 'staff, a' }), /Panel posted[\s\S]*`a`/, 'it says which forms are still closed');
  const buttonRow = panels.at(-1).components[0].toJSON().components.at(-1).components;
  assert.deepEqual(buttonRow.map((b) => b.custom_id), [`fm:o:${id}`, `fm:o:${formA.id}`]);
  const viaMenu = await actions.postPanel({ guild, channel: panelChannel, formList: [staffForm(), formA], style: 'select' });
  const menu = panels.at(-1).components[0].toJSON().components.at(-1).components[0];
  assert.equal(menu.custom_id, `fm:s:${viaMenu.panel.id}`); assert.deepEqual(menu.options.map((o) => o.value), [String(id), String(formA.id)]);
  templates.set('apply', { data: {} });
  await talk('panel', { channel: panelChannel, forms: 'staff', template: 'apply' });
  assert.equal(panels.at(-1).embeds[0].title, 'apply', 'a saved embed carries the buttons'); assert.equal(panels.at(-1).components.length, 1);
  assert.equal((await actions.postPanel({ guild, channel: panelChannel, formList: [] })).error, 'no_forms');
  assert.match(await talk('panel', { channel: panelChannel, forms: 'nope' }), /no form called `nope`/);
  // The menu of a panel opens the form it names.
  shownModals.length = 0;
  await handleFormInteraction(interaction(`fm:s:${viaMenu.panel.id}`, 'select', { member: makeMember('u3', { roleIds: ['member'] }), values: [String(id)] }));
  assert.equal(shownModals.at(-1)?.custom_id, `fm:p:${id}:0`);

  // Retention and the cap of stored submissions: the oldest reviewed ones make room, pending ones never do.
  assert.match(await talk('retention', {}), /kept \*\*30\*\* days[\s\S]*Stored: 3\/2000/);
  assert.match(await talk('retention', { days: 7 }), /kept \*\*7\*\* days/); assert.equal(db.retention, 7);
  assert.match(await talk('retention', { days: 7 }, plain), /Manage Server/);
  require('../src/utils/forms').FORM_LIMITS.submissions = 3;
  const u4 = makeMember('u4', { roleIds: ['member'] });
  const fourth = await actions.submitForm({ client, guild, form: staffForm(), member: u4, answers: db.subs[2].answers });
  assert.equal(fourth.ok, true); assert.equal(db.subs.length, 3, 'the oldest reviewed submission made room'); assert.ok(!db.subs.some((x) => x.number === 1));
  for (const x of db.subs) x.status = 'pending';
  const fifth = await actions.submitForm({ client, guild, form: staffForm(), member: makeMember('u5', { roleIds: ['member'] }), answers: db.subs[0].answers });
  assert.equal(fifth.error, 'full', 'pending submissions are never deleted to make room');
  require('../src/utils/forms').FORM_LIMITS.submissions = 2000;
  const compacted = cards.reviewCard({ submission: { ...long, status: 'accepted', compacted: true, answers: [] } });
  assert.match(JSON.stringify(compacted.container.toJSON()), /answers were removed after the retention/); assert.equal(compacted.file, null);

  // ---- The web link of a form: a random public id (never its number), shown by info and changed by relink.
  {
    const ids = new Set(Array.from({ length: 2000 }, () => forms.newPublicId()));
    assert.equal(ids.size, 2000, 'public ids do not repeat');
    for (const id of ids) assert.match(id, forms.PUBLIC_ID);
    const staff = staffForm();
    assert.match(staff.public_id, /^[0-9A-Za-z]{12}$/, 'a new form gets a public id');
    assert.notEqual(staff.public_id, db.forms.find((f) => f.name === 'a')?.public_id ?? null);
    assert.equal(forms.webUrl(staff), `https://petto.sbs/f/${staff.public_id}`);
    assert.ok(!forms.webUrl(staff).endsWith(`/${staff.id}`), 'the link never shows the number');
    assert.ok((await talk('info', { form: 'staff' })).includes(`petto.sbs/f/${staff.public_id}`), '!form info shows the link');
    const old = staff.public_id;
    const relinked = await talk('relink', { form: 'staff' });
    assert.notEqual(staffForm().public_id, old, 'relink makes a new id'); assert.ok(relinked.includes(`petto.sbs/f/${staffForm().public_id}`)); assert.match(relinked, /old link no longer works/);
    assert.match(await talk('relink', { form: 'staff' }, plain), /Manage Server/, 'only managers change the link');
    const before = staffForm().public_id;
    assert.match(await talk('set', { form: 'staff', setting: 'link', value: 'maybe' }), /link new/); assert.equal(staffForm().public_id, before, 'only "new" changes it');
    assert.ok((await talk('set', { form: 'staff', setting: 'link', value: 'new' })).includes(`petto.sbs/f/${staffForm().public_id}`)); assert.notEqual(staffForm().public_id, before, '!form set <form> link new');
  }

  // Deleting a form keeps what was sent.
  assert.match(await talk('delete', { form: 'staff' }), /deleted/); assert.equal(db.subs.length, 3); assert.ok(db.subs.every((x) => x.form_id === null));

  // ---- Filling a form on the website (petto.sbs/f/<public id>): the two routes, with the same rules and the same pipeline, marked "web".
  {
    const { registerFormRoutes } = require('../src/web/formRoutes');
    const handlers = {};
    registerFormRoutes({ post: (path, ...fns) => { handlers[path] = fns.at(-1); } }, { authorize: async () => null, isAuthorized: (req) => req.key === 'ok', client: { guilds: { cache: new Map([['g1', guild]]) } } });
    const call = async (name, formId, body, key = 'ok') => {
      let status = 200; let payload = null;
      const res = { status(code) { status = code; return this; }, json(p) { payload = p; return this; }, set() { return this; } };
      await handlers[`/api/dashboard/form/:formId/${name}`]({ key, params: { formId: String(formId) }, body, query: {}, get: () => null }, res);
      return { status, ...payload };
    };
    const webForm = { ...forms.normalizeForm({ name: 'event', title: 'Event sign-up', status: 'open', review_channel_id: 'review', required_role_ids: ['member'],
      questions: [{ id: 'name', type: 'short', label: 'Name', min_length: 2 }, { id: 'age', type: 'number', label: 'Age', min_value: 13, max_value: 99 }, { id: 'team', type: 'choice', label: 'Team', options: ['Red', 'Blue'] },
        { id: 'days', type: 'multi', label: 'Days', options: ['Fri', 'Sat', 'Sun'], max_choices: 2, required: false }, { id: 'rules', type: 'yesno', label: 'Rules?' }] }), id: 900, public_id: 'x7Kp9QzA2mVt', guild_id: 'g1' };
    const PID = webForm.public_id;
    webForm.required_role_ids = ['member']; webForm.review_channel_id = 'review';
    db.forms.push(webForm);
    makeMember('111111111111111111', { roleIds: [] });
    makeMember('222222222222222222', { roleIds: ['member'] });
    assert.equal((await call('public', PID, { user_id: '123456789012345678' }, 'bad')).status, 401, 'the dashboard key is needed');
    assert.equal((await call('public', 999, { user_id: '123456789012345678' })).status, 404);
    assert.equal((await call('public', 900, { user_id: '222222222222222222' })).status, 404, 'the number of a form does not open it on the web');
    assert.equal((await call('submit', 900, { user_id: '222222222222222222', values: {} })).status, 404, 'nor sends it');
    assert.equal((await call('public', 'x7Kp9QzA2mVu', { user_id: '222222222222222222' })).status, 404, 'an unknown public id');
    const shown = await call('public', PID, { user_id: '123456789012345678' });
    assert.equal(shown.can, false); assert.equal(shown.code, 'notMember', 'only members of the server');
    const outsider = await call('public', PID, { user_id: '111111111111111111' });
    assert.equal(outsider.code, 'roles'); assert.match(outsider.reason, /@member/, 'role mentions become names on the web');
    const ok = await call('public', PID, { user_id: '222222222222222222' });
    assert.equal(ok.can, true); assert.equal(ok.form.id, PID, 'the page gets the public id, not the number'); assert.equal(ok.form.questions.length, 5); assert.equal(ok.form.questions[2].options[1], 'Blue');
    assert.equal(ok.form.review_channel_id, undefined, 'the review settings stay private');
    const bad = await call('submit', PID, { user_id: '222222222222222222', values: { name: 'L', age: '7', team: 'o5', days: ['o0', 'o1', 'o2'] } });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.errors.map((e) => `${e.id}:${e.code}`).sort(), ['age:range', 'days:invalid', 'name:short', 'rules:required', 'team:required'], 'the same checks as in Discord');
    const before = sent.length;
    const done = await call('submit', PID, { user_id: '222222222222222222', values: { name: 'Liam', age: '21', team: 'o1', days: ['o0', 'o2'], rules: 'yes' } });
    assert.equal(done.ok, true, JSON.stringify(done)); assert.match(done.message, /sent/);
    const sub = db.subs.at(-1);
    assert.equal(sub.source, 'web'); assert.deepEqual(sub.answers.map((a) => a.value), ['Liam', '21', 'Blue', ['Fri', 'Sun'], 'yes']);
    assert.equal(sent.length, before + 1, 'the card goes to the review channel'); assert.match(textOf(sent.at(-1)), /sent on the web/);
    assert.equal((await call('public', PID, { user_id: '222222222222222222' })).code, 'pending', 'one pending submission, on the web too');
    db.forms.find((f) => f.id === 900).web_enabled = false;
    assert.equal((await call('public', PID, { user_id: '222222222222222222' })).code, 'webOff', 'a server can keep a form in Discord only');
    assert.equal((await call('submit', PID, { user_id: '222222222222222222', values: {} })).status, 403);
    // The panel can add a "Fill on the web" link.
    const rows = cards.panelRows([{ ...webForm, web_enabled: true }], { web: true, lang: 'en' }).map((r) => r.toJSON());
    assert.equal(rows.at(-1).components[0].url, 'https://petto.sbs/f/x7Kp9QzA2mVt'); assert.equal(rows.at(-1).components[0].label, 'Fill on the web');
    assert.equal(cards.panelRows([webForm], { web: true }).length, 1, 'no link for a form kept in Discord');
  }
  console.log('Checked forms: questions, rules, pages with Next, review card, accept and deny with roles and DM, reviewers, panels, !form and filling on the web.');
})().catch((error) => { console.error(error); process.exit(1); });
