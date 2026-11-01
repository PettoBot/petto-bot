// Checks the questions of a ticket form beyond plain text (choices, radio buttons, checkboxes, one checkbox, file uploads, member / role / channel
// pickers and texts that only inform): how they are stored and cleaned, the modal Discord gets (up to 5 parts, labels, limits), how a submitted
// modal is read, what happens to the files (pictures only where asked, copied into the ticket channel, the link kept when the copy fails), how the
// answers look in the ticket, and that a form with text questions only is exactly what it always was. Discord and the database are fakes.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, ComponentType, MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// ── What the handler of the form talks to ───────────────────────────────────
const opened = [];
let category = { id: 7, form_id: 3 };
let form = null;
stub('src/db/database.js', { from: () => ({}) });
stub('src/db/tickets.js', { getCategoryById: async () => category });
stub('src/db/ticketForms.js', { getFormById: async () => form, normalizeFields: require('../src/utils/ticketFormFields').normalizeFields });
stub('src/utils/ticketActions.js', { openTicket: async (args) => { opened.push(args); return { channel: { toString: () => '<#900>' } }; } });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const fieldsLib = require('../src/utils/ticketFormFields');
const answers = require('../src/utils/ticketAnswers');
const { handleModal } = require('../src/interactions/ticketForm');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const PDF = Buffer.from('%PDF-1.7 hello pdf hello pdf');
const EXE = Buffer.from('MZ\u0090\u0000 not a picture at all, just bytes');
const cdn = (name, id = '1') => `https://cdn.discordapp.com/attachments/10/${id}/${name}?ex=1&is=2&hm=3`;
const upload = (id, name, type, size, extra = {}) => ({ id, name, url: cdn(name, id), size, contentType: type, description: null, ...extra });

/** What `interaction.fields.fields` holds after a member sent the form (the same shapes discord.js gives). */
function submitted(values) {
  const map = new Collection();
  for (const [id, [type, data]] of Object.entries(values)) map.set(`field::${id}`, { type, customId: `field::${id}`, ...data });
  return map;
}
const text = (value) => [ComponentType.TextInput, { value }];

function modalInteraction(values, calls = []) {
  return {
    calls,
    customId: 'tk_form::7::3',
    user: { id: '5' },
    guild: { id: '10', premiumTier: 0 },
    client: {},
    locale: 'en-US',
    fields: { fields: submitted(values) },
    reply: async (payload) => calls.push({ reply: payload }),
    deferReply: async () => calls.push({ defer: true }),
    editReply: async (payload) => calls.push({ edit: payload }),
  };
}

const ALL_TYPES = [
  { id: 'subject', type: 'short_text', label: 'Subject', placeholder: 'A few words' },
  { id: 'topic', type: 'select', label: 'Topic', options: ['Billing', 'Bug', 'Other'], max: 2 },
  { id: 'proof', type: 'file', label: 'Screenshots', accept: 'images', max: 3 },
  { id: 'who', type: 'user', label: 'Which member?', required: false },
  { id: 'agree', type: 'check', label: 'I read the rules', required: true },
];

(async () => {
  // ── Storage: what is kept for each question, and today's text questions exactly as they were ───────────────
  const legacy = [{ id: 'what', type: 'long_text', label: 'What happened?', placeholder: 'Describe it', required: true }, { id: 'note', type: 'short_text', label: 'Optional note', required: false }];
  assert.deepEqual(fieldsLib.normalizeFields(legacy), [
    { id: 'what', type: 'long_text', label: 'What happened?', placeholder: 'Describe it', required: true },
    { id: 'note', type: 'short_text', label: 'Optional note', placeholder: undefined, required: false },
  ], 'text questions come out exactly as before');
  assert.deepEqual(fieldsLib.normalizeFields([{ type: 'short_text', label: 'Name' }]), [{ id: 'name', type: 'short_text', label: 'Name', placeholder: undefined, required: true }], 'the id is made from the label, required by default');

  const clean = fieldsLib.normalizeFields([
    { type: 'dropdown', label: 'Topic', options: 'Billing\nBug\nBug\n  \nOther', max: 9 },
    { type: 'radio', id: 'r', label: 'Urgent?', options: ['Yes', 'No'], required: false },
    { type: 'checkboxes', label: 'Platforms', options: ['PC', 'Console', 'Phone'], max: 2 },
    { type: 'file', label: 'Proof', accept: 'whatever', max: 99 },
    { type: 'channel', label: 'Where', max: 0, placeholder: 'Pick one' },
  ]);
  assert.deepEqual(clean[0], { id: 'topic', type: 'select', label: 'Topic', required: true, options: ['Billing', 'Bug', 'Other'], max: 3 }, 'a menu: repeated and empty choices are dropped, max cannot pass the choices');
  assert.deepEqual([clean[1].required, clean[2].max, clean[3].accept, clean[3].max, clean[4].max, clean[4].placeholder], [false, 2, 'any', 5, 1, 'Pick one']);
  assert.equal(fieldsLib.normalizeFields([{ type: 'file', label: 'Pics', accept: 'images', max: 2 }, { type: 'short_text', label: 'x' }])[0].accept, 'images');
  const info = fieldsLib.normalizeFields([{ type: 'info', content: 'Read the **rules** first.' }, { type: 'short_text', label: 'x' }]);
  assert.deepEqual([info[0].type, info[0].content, info[0].label], ['display', 'Read the **rules** first.', 'Read the **rules** first.']);
  assert.equal(fieldsLib.normalizeFields([{ id: 'a', type: 'short_text', label: 'A' }, { id: 'a', type: 'long_text', label: 'B' }]).map((f) => f.id).join(), 'a,a_2', 'two questions never share an id');
  assert.deepEqual(fieldsLib.normalizeFields([{ type: 'check', label: 'Tick', required: true }, { type: 'short_text', label: 'x' }])[0], { id: 'tick', type: 'check', label: 'Tick', required: true });

  const refuses = (fields, what) => assert.throws(() => fieldsLib.normalizeFields(fields), (error) => error.message.includes(what) || (console.error(error.message), false));
  refuses([], '1 and 5');
  refuses(Array.from({ length: 6 }, (_u, i) => ({ type: 'short_text', label: `q${i}` })), '1 and 5');
  refuses([{ type: 'number', label: 'n' }], 'must be one of');
  refuses([{ type: 'select', label: 'Menu', options: [] }], '1 to 25 choices');
  refuses([{ type: 'radio', label: 'R', options: ['only'] }], '2 to 10 choices');
  refuses([{ type: 'checkboxes', label: 'C', options: Array.from({ length: 11 }, (_u, i) => `o${i}`) }], '1 to 10 choices');
  refuses([{ type: 'select', label: '', options: ['a'] }], 'needs an id and label');
  refuses([{ type: 'display', content: 'Only a text' }], 'at least one question');
  refuses([{ type: 'display', content: '' }, { type: 'short_text', label: 'x' }], 'needs its text');
  assert.equal(fieldsLib.normalizeFields([{ type: 'short_text', label: 'x'.repeat(80) }])[0].label.length, 45, 'a label is cut to the 45 characters Discord takes');

  // A form saved by the dashboard is never trusted: what Discord would refuse is cut down or left out, and it never throws.
  const messy = fieldsLib.usableFields([{ type: 'select', label: 'M', options: ['a'], max: 50 }, { type: 'bogus', label: 'z' }, { type: 'radio', label: 'R', options: ['one'] }, ...Array.from({ length: 8 }, (_u, i) => ({ type: 'short_text', label: `q${i}` }))]);
  assert.equal(messy.length, 5, 'at most 5 parts');
  assert.deepEqual([messy[0].type, messy[0].max, messy[1].label], ['select', 1, 'q0'], 'a broken question is left out');
  assert.deepEqual(fieldsLib.usableFields('nothing'), []);
  assert.deepEqual(fieldsLib.usableFields([{ type: 'display', content: 'x' }]), [], 'only a text asks nothing: the form is not usable');

  // ── The modal: every type builds a valid modal (no more than 5 parts, labels and limits) ──────────────────
  const build = (fields) => fieldsLib.buildFormModal({ customId: 'tk_form::7::3', title: 'Ticket details', fields: fieldsLib.normalizeFields(fields) }).toJSON();
  const json = build(ALL_TYPES);
  assert.equal(json.components.length, 5);
  assert.deepEqual(json.components.map((part) => part.component.type), [ComponentType.TextInput, ComponentType.StringSelect, ComponentType.FileUpload, ComponentType.UserSelect, ComponentType.Checkbox]);
  assert.deepEqual(json.components.map((part) => part.type), [18, 18, 18, 18, 18], 'every part is under a label');
  assert.deepEqual(json.components.map((part) => part.component.custom_id), ['field::subject', 'field::topic', 'field::proof', 'field::who', 'field::agree']);
  const [subject, topic, proof, who, agree] = json.components;
  assert.deepEqual([subject.label, subject.component.placeholder, subject.component.required, subject.component.style], ['Subject', 'A few words', true, 1]);
  assert.deepEqual([topic.component.min_values, topic.component.max_values, topic.component.options.map((o) => o.label)], [1, 2, ['Billing', 'Bug', 'Other']]);
  assert.deepEqual([proof.component.min_values, proof.component.max_values, proof.component.required], [1, 3, true]);
  assert.deepEqual([who.component.min_values, who.component.max_values, who.component.required], [0, 1, false], 'an optional picker may be left empty');
  assert.equal(agree.component.default, false);

  const more = build([
    { type: 'long_text', label: 'Story', description: 'Tell us what happened' },
    { type: 'radio', label: 'Urgent?', options: ['Yes', 'No'] },
    { type: 'checkboxes', label: 'Platforms', options: ['PC', 'Console'], required: false },
    { type: 'role', label: 'Role' },
    { type: 'channel', label: 'Channel', required: false },
  ]);
  assert.deepEqual(more.components.map((part) => part.component.type), [ComponentType.TextInput, ComponentType.RadioGroup, ComponentType.CheckboxGroup, ComponentType.RoleSelect, ComponentType.ChannelSelect]);
  assert.equal(more.components[0].description, 'Tell us what happened');
  assert.deepEqual(more.components[1].component.options.map((o) => o.value), ['Yes', 'No']);
  assert.deepEqual([more.components[2].component.min_values, more.components[2].component.max_values], [0, 2]);
  const withText = build([{ type: 'display', content: 'Please read **this**' }, { type: 'short_text', label: 'Why' }]);
  assert.deepEqual(withText.components[0], { type: 10, content: 'Please read **this**' }, 'a text that only informs sits alone');
  assert.equal(withText.components.length, 2);
  // The old text-only form: the same labels, ids, placeholders and required marks as the window it always had.
  const old = build(legacy).components;
  assert.deepEqual(old.map((part) => [part.component.custom_id, part.label, part.component.style, part.component.required, part.component.placeholder]), [['field::what', 'What happened?', 2, true, 'Describe it'], ['field::note', 'Optional note', 1, false, undefined]]);

  // ── Reading a submitted modal, one answer for each type ────────────────────────────────────────────────
  const fields = fieldsLib.normalizeFields([
    ...ALL_TYPES,
    // (a second set is read below; a form holds 5 parts, so each read uses at most 5 of these)
  ]);
  const read = fieldsLib.readAnswers(fields, submitted({
    subject: text('  Cannot log in  '),
    topic: [ComponentType.StringSelect, { values: ['Bug', 'Hacked', 'Billing'] }],
    proof: [ComponentType.FileUpload, { values: ['1'], attachments: new Collection([['1', upload('1', 'shot.png', 'image/png', 2048)]]) }],
    who: [ComponentType.UserSelect, { values: ['123456789012345678'] }],
    agree: [ComponentType.Checkbox, { value: true }],
  }));
  assert.deepEqual(read.missing, []);
  assert.deepEqual(read.entries.map((entry) => [entry.id, entry.type]), [['subject', 'short_text'], ['topic', 'select'], ['proof', 'file'], ['who', 'user'], ['agree', 'check']]);
  assert.equal(read.entries[0].value, 'Cannot log in', 'a text is trimmed');
  assert.deepEqual(read.entries[1].value, ['Bug', 'Billing'], 'a choice that is not in the form is dropped');
  assert.deepEqual(read.entries[2].value, [{ id: '1', name: 'shot.png', url: cdn('shot.png', '1'), size: 2048, type: 'image/png' }]);
  assert.equal(read.entries[2].accept, 'images');
  assert.deepEqual([read.entries[3].value, read.entries[4].value], [['123456789012345678'], true]);

  const second = fieldsLib.normalizeFields([
    { type: 'radio', id: 'urgent', label: 'Urgent?', options: ['Yes', 'No'] },
    { type: 'checkboxes', id: 'plat', label: 'Platforms', options: ['PC', 'Console'], required: false },
    { type: 'role', id: 'role', label: 'Role', required: false },
    { type: 'channel', id: 'chan', label: 'Channel', required: false },
    { type: 'check', id: 'tick', label: 'Tick', required: true },
  ]);
  const read2 = fieldsLib.readAnswers(second, submitted({
    urgent: [ComponentType.RadioGroup, { value: 'No' }],
    plat: [ComponentType.CheckboxGroup, { values: ['PC', 'Console'] }],
    role: [ComponentType.RoleSelect, { values: ['222222222222222222'] }],
    chan: [ComponentType.ChannelSelect, { values: ['333333333333333333'] }],
    tick: [ComponentType.Checkbox, { value: false }],
  }));
  assert.deepEqual(read2.entries.map((entry) => entry.value), [['No'], ['PC', 'Console'], ['222222222222222222'], ['333333333333333333'], false]);
  assert.deepEqual(read2.missing, ['Tick'], 'a required checkbox has to be ticked');
  const empty = fieldsLib.readAnswers(second, submitted({ urgent: [ComponentType.RadioGroup, { value: null }] }));
  assert.deepEqual(empty.missing, ['Urgent?', 'Tick'], 'a required radio group left empty, and fields Discord did not send at all, count as empty');

  // ── The files: pictures only where asked, copied with the safe download, the link kept when the copy fails ─
  const picture = (id, name, type = 'image/png', size = 2048) => ({ id, name, url: cdn(name, id), size, type });
  const entryOf = (accept, ...files) => ({ id: 'proof', type: 'file', label: 'Proof', accept, value: files });
  const bytes = { 'a.png': PNG, 'b.jpg': JPG, 'doc.pdf': PDF, 'fake.png': EXE, 'weird.bin': PDF };
  const downloads = [];
  const download = async (url, _request, options) => {
    const name = new URL(url).pathname.split('/').pop();
    downloads.push([name, options.maxBytes]);
    if (name === 'broken.png') throw new Error('The image server answered 404.');
    return bytes[name];
  };
  const guild = { id: '10', premiumTier: 0 };

  const ok = entryOf('images', picture('1', 'a.png'), picture('2', 'b.jpg', 'image/jpeg'));
  assert.deepEqual(await answers.prepareFiles([ok], { guild, download }), { refused: null });
  assert.deepEqual(ok.value.map((file) => [file.image, Buffer.isBuffer(file.data)]), [[true, true], [true, true]]);
  assert.ok(downloads.every(([, max]) => max === 8 * 1024 * 1024), 'each file is limited to 8 MB');

  const notPicture = entryOf('images', picture('1', 'a.png'), picture('3', 'doc.pdf', 'application/pdf'));
  downloads.length = 0;
  assert.deepEqual(await answers.prepareFiles([notPicture], { guild, download }), { refused: { label: 'Proof', name: 'doc.pdf' } }, 'a PDF is refused where only pictures are taken');
  assert.deepEqual(downloads.map(([name]) => name), ['a.png'], 'a file the type already refuses is not even downloaded');
  const lying = entryOf('images', picture('4', 'fake.png'));
  assert.deepEqual(await answers.prepareFiles([lying], { guild, download }), { refused: { label: 'Proof', name: 'fake.png' } }, 'a program named .png is refused by its first bytes');
  const noType = entryOf('images', picture('5', 'weird.bin', ''));
  assert.deepEqual((await answers.prepareFiles([noType], { guild, download })).refused?.name, 'weird.bin', 'no type and no picture extension: refused');

  const any = entryOf('any', picture('3', 'doc.pdf', 'application/pdf'), picture('4', 'fake.png'));
  assert.deepEqual(await answers.prepareFiles([any], { guild, download }), { refused: null }, 'any file is taken');
  assert.deepEqual(any.value.map((file) => file.image), [false, false], 'a file is only drawn as a picture when its bytes are one');

  const failing = entryOf('images', picture('6', 'broken.png'), picture('1', 'a.png'));
  assert.deepEqual(await answers.prepareFiles([failing], { guild, download }), { refused: null }, 'a failed download of a picture does not refuse it');
  assert.deepEqual([failing.value[0].reason, failing.value[0].data, failing.value[1].reason], ['failed', null, undefined]);
  const huge = entryOf('any', picture('7', 'a.png', 'image/png', 9 * 1024 * 1024));
  downloads.length = 0;
  await answers.prepareFiles([huge], { guild, download });
  assert.deepEqual([huge.value[0].reason, downloads.length], ['big', 0], 'a file over the limit is not downloaded');
  assert.equal(answers.uploadLimit({ premiumTier: 3 }), 8 * 1024 * 1024, 'never more than 8 MB for a file');
  const many = entryOf('any', ...Array.from({ length: 5 }, (_u, i) => picture(String(10 + i), 'a.png')));
  const many2 = { ...entryOf('any', ...Array.from({ length: 5 }, (_u, i) => picture(String(20 + i), 'b.jpg'))), id: 'more' };
  const many3 = { ...entryOf('any', picture('30', 'a.png')), id: 'third' };
  await answers.prepareFiles([many, many2, many3], { guild, download });
  assert.deepEqual([many3.value[0].reason, many2.value[4].reason], ['limit', undefined], 'a ticket keeps up to 10 files, the rest stay as links');

  // ── The cards in the ticket ───────────────────────────────────────────────────────────────────────────
  const shot = { id: '1', name: 'screen*shot [1].png', url: cdn('screen.png', '1'), size: 2048, type: 'image/png', image: true, data: PNG };
  const shot2 = { id: '2', name: 'second.jpg', url: cdn('second.jpg', '2'), size: 4096, type: 'image/jpeg', image: true, data: JPG };
  const doc = { id: '3', name: 'report (final).pdf', url: cdn('report.pdf', '3'), size: 1536, type: 'application/pdf', image: false, data: PDF };
  const lost = { id: '4', name: 'lost.png', url: cdn('lost.png', '4'), size: 3 * 1024 * 1024, type: 'image/png', image: true, data: null, reason: 'failed' };
  const entries = [
    { id: 'subject', type: 'short_text', label: 'Subject', value: 'Cannot log in' },
    { id: 'topic', type: 'select', label: 'Topic', value: ['Billing', 'Bug'] },
    { id: 'one', type: 'radio', label: 'Urgent?', value: ['Yes'] },
    { id: 'agree', type: 'check', label: 'Rules read', value: true },
    { id: 'no', type: 'check', label: 'Newsletter', value: false },
    { id: 'who', type: 'user', label: 'Member', value: ['111111111111111111'] },
    { id: 'role', type: 'role', label: 'Role', value: ['222222222222222222'] },
    { id: 'chan', type: 'channel', label: 'Channel', value: ['333333333333333333'] },
    { id: 'skip', type: 'short_text', label: 'Note', value: '' },
    { id: 'proof', type: 'file', label: 'Screenshots', accept: 'images', value: [shot, shot2, lost] },
    { id: 'docs', type: 'file', label: 'Documents', accept: 'any', value: [doc] },
  ];
  const messages = answers.buildAnswerMessages(entries, { guild });
  const all = messages.map((message) => message.components[0].toJSON());
  const flat = (node) => [node, ...(node.components ?? []).flatMap(flat), ...(node.items ?? [])];
  const parts = all.flatMap(flat);
  const texts = parts.filter((part) => part.type === 10).map((part) => part.content).join('\n');
  assert.ok(messages.every((message) => message.flags === MessageFlags.IsComponentsV2));
  assert.ok(messages.every((message) => message.allowedMentions && message.allowedMentions.parse.length === 0), 'nothing the answers mention notifies anyone (no @everyone, no roles, no members)');
  assert.ok(texts.startsWith('### Submitted form\n**Subject:** Cannot log in\n**Topic:**\n- Billing\n- Bug\n**Urgent?:** Yes\n**Rules read:** ✅\n**Newsletter:** ❌\n**Member:** <@111111111111111111>\n**Role:** <@&222222222222222222>\n**Channel:** <#333333333333333333>\n**Note:** —\n**Screenshots:**'), texts);
  const gallery = parts.find((part) => part.type === 12);
  assert.deepEqual(gallery.items.map((item) => item.media.url), ['attachment://screen_shot_1.png', 'attachment://second.jpg'], 'the pictures are shown as a media gallery of the files uploaded in the same message');
  const fileCard = parts.find((part) => part.type === 13);
  assert.equal(fileCard.file.url, 'attachment://report_final.pdf', 'any other file is a file card');
  const sent = messages.flatMap((message) => (message.files ?? []).map((file) => [file.name, file.attachment.length]));
  assert.deepEqual(sent, [['screen_shot_1.png', PNG.length], ['second.jpg', JPG.length], ['report_final.pdf', PDF.length]], 'every copied file is uploaded again as an attachment');
  assert.ok(texts.includes('[lost.png](https://cdn.discordapp.com/attachments/10/4/lost.png?ex=1&is=2&hm=3) · 3.0 MB\n-# '), 'a file that could not be copied keeps its link, name and size');
  assert.ok(/could not copy this file, so its link may stop working/.test(texts), 'and the card says so');
  assert.ok(!/screen\*shot/.test(texts) || /screen\\\*shot/.test(texts), 'names are escaped');
  const noLinkFiles = parts.filter((part) => part.type === 12 || part.type === 13).length;
  assert.equal(noLinkFiles, 2, 'one gallery and one file');

  // The weight of one message is what Discord takes: 4000 characters of text, 40 components, 10 files, and the bytes of the server.
  const big = [{ id: 'a', type: 'long_text', label: 'Story', value: 'x'.repeat(5000) }, ...Array.from({ length: 5 }, (_u, i) => ({ id: `b${i}`, type: 'short_text', label: `Q${i}`, value: 'y'.repeat(1500) }))];
  const bigMessages = answers.buildAnswerMessages(big, { guild });
  assert.ok(bigMessages.length > 1, 'a lot of text goes in several cards');
  for (const message of bigMessages) {
    const json = message.components[0].toJSON();
    const sum = flat(json).filter((part) => part.type === 10).reduce((total, part) => total + part.content.length, 0);
    assert.ok(sum <= 4000, `a message holds at most 4000 characters of text (${sum})`);
    assert.ok(flat(json).length <= 40);
  }
  assert.ok(bigMessages.flatMap((message) => message.components[0].toJSON().components).flatMap((part) => part.content.split('\n')).every((line) => line.length <= 1100), 'a long answer is cut to 1000 characters');
  assert.ok(/…/.test(bigMessages[0].components[0].toJSON().components[0].content), 'with a mark that it was cut');
  const heavy = [{ id: 'p', type: 'file', label: 'Photos', accept: 'images', value: Array.from({ length: 5 }, (_u, i) => ({ id: String(i), name: `p${i}.png`, url: cdn(`p${i}.png`, String(i)), size: 5 * 1024 * 1024, type: 'image/png', image: true, data: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length)]) })) }];
  const heavyMessages = answers.buildAnswerMessages(heavy, { guild });
  assert.ok(heavyMessages.length >= 3, 'files are split so the weight of one message stays within what the server takes');
  assert.ok(heavyMessages.every((message) => (message.files ?? []).reduce((total, file) => total + file.attachment.length, 0) <= 8 * 1024 * 1024));

  assert.equal(answers.showName('a_b*c [x] @everyone <@1>.pdf\nnext'), 'a\\_b\\*c \\[x\\] \\@everyone \\<\\@1\\>.pdf next', 'a file name cannot format, link or mention');
  assert.equal(answers.copyName('../../etc/pass wd.TXT', new Set()), 'pass_wd.txt', 'the uploaded copy has a plain name, no path');
  const taken = new Set();
  assert.deepEqual([answers.copyName('a.png', taken), answers.copyName('a.png', taken)], ['a.png', 'a-2.png'], 'two files of a message never share a name');

  // The old card: a form of text questions looks exactly as it did.
  const oldCard = answers.buildAnswerMessages([{ type: 'long_text', label: 'What happened?', value: 'It broke' }, { type: 'short_text', label: 'Optional note', value: 'ok' }], { guild });
  assert.equal(oldCard.length, 1);
  assert.deepEqual(oldCard[0].components[0].toJSON().components, [{ type: 10, content: '### Submitted form\n**What happened?:** It broke\n**Optional note:** ok' }]);
  assert.deepEqual(answers.answersMap(entries.slice(0, 5)), { Subject: 'Cannot log in', Topic: 'Billing, Bug', 'Urgent?': 'Yes', 'Rules read': '✅', Newsletter: '❌' }, 'what the ticket stores about the answers');
  assert.equal(answers.answersMap([{ label: 'Same', type: 'short_text', value: 'a' }, { label: 'Same', type: 'short_text', value: 'b' }])['Same (2)'], 'b', 'two questions with the same label are both kept');

  // Sending: when Discord refuses a message that carries files, its answers are sent again with their links.
  const sentPayloads = [];
  let first = true;
  const clone = (file) => ({ ...file });
  await answers.postAnswers([{ id: 'proof', type: 'file', label: 'Proof', accept: 'images', value: [clone(shot)] }], {
    guild,
    send: async (payload) => { if (first && payload.files?.length) { first = false; throw new Error('Missing Permissions'); } sentPayloads.push(payload); },
  });
  assert.equal(sentPayloads.length, 1);
  assert.ok(!sentPayloads[0].files && sentPayloads[0].components[0].toJSON().components[0].content.includes('Petto could not copy this file'), 'the retry has no files, only the link');

  // ── The form as the member submits it ──────────────────────────────────────────────────────────────────
  form = { id: 3, title: 'Ticket details', fields: ALL_TYPES };
  const good = modalInteraction({
    subject: text('Cannot log in'),
    topic: [ComponentType.StringSelect, { values: ['Bug'] }],
    proof: [ComponentType.FileUpload, { values: ['1'], attachments: new Collection([['1', upload('1', 'a.png', 'image/png', 2048)]]) }],
    who: [ComponentType.UserSelect, { values: [] }],
    agree: [ComponentType.Checkbox, { value: true }],
  });
  await handleModal(good, { download });
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].formAnswers, { Subject: 'Cannot log in', Topic: 'Bug', Screenshots: 'a.png', 'Which member?': '', 'I read the rules': '✅' });
  assert.equal(opened[0].formEntries[2].value[0].image, true);
  assert.ok(good.calls[0].defer, 'the answer is deferred first: copying files takes a while');
  assert.ok(String(good.calls.at(-1).edit.content).includes('<#900>'), 'the member is told where the ticket is');

  opened.length = 0;
  const bad = modalInteraction({
    subject: text('x'),
    topic: [ComponentType.StringSelect, { values: ['Bug'] }],
    proof: [ComponentType.FileUpload, { values: ['3'], attachments: new Collection([['3', upload('3', 'doc.pdf', 'application/pdf', 2048)]]) }],
    agree: [ComponentType.Checkbox, { value: true }],
  });
  await handleModal(bad, { download });
  assert.equal(opened.length, 0, 'no ticket is opened for a file that is not a picture');
  const refusal = bad.calls.at(-1).edit.content;
  assert.ok(refusal.includes('**Screenshots** only takes pictures') && refusal.includes('**doc.pdf**'), refusal);
  assert.ok(!bad.calls.some((call) => call.reply), 'the refusal is a private edit of the deferred answer');

  const unticked = modalInteraction({ subject: text('x'), topic: [ComponentType.StringSelect, { values: ['Bug'] }], proof: [ComponentType.FileUpload, { values: [], attachments: new Collection() }], agree: [ComponentType.Checkbox, { value: false }] });
  await handleModal(unticked, { download });
  assert.equal(opened.length, 0);
  assert.ok(unticked.calls.at(-1).edit.content.includes('Screenshots'), 'a required question left empty is asked for');

  // An old form of text questions still opens a ticket with the answers it always sent.
  form = { id: 3, title: 'Ticket details', fields: legacy };
  const plain = modalInteraction({ what: text('It broke'), note: text('') });
  await handleModal(plain, { download });
  assert.deepEqual(opened[0].formAnswers, { 'What happened?': 'It broke', 'Optional note': '' });
  form = { id: 3, title: 'T', fields: [{ type: 'display', content: 'nothing to ask' }] };
  const none = modalInteraction({});
  await handleModal(none, { download });
  assert.ok(none.calls.at(-1).edit && /./.test(String(none.calls.at(-1).edit.content)), 'a form with nothing to answer is not available (a private edit of the announced answer)');

  console.log('Checked the ticket form questions: types, modal, answers, files (pictures only, copied, link kept), and the cards.');
})().catch((error) => { console.error(error); process.exit(1); });
