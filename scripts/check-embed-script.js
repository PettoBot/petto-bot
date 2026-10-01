// Checks how an embed written as one code is read, and runs `/embed create code:` against a fake server, so a change
// to the reader or to the command shows up without a bot or a database.
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseEmbedScript, toTemplateData } = require('../src/utils/embedScript');

// A code from another bot: a description with line breaks and a link, and a footer.
let r = parseEmbedScript('{embed}$v{description: → Follow discord [TOS](https://discord.com/terms)\n→ No NSFW Content}$v{footer: Have Fun: Engage, enjoy}');
assert.deepEqual(r.warnings, []);
assert.equal(r.embed.description, '→ Follow discord [TOS](https://discord.com/terms)\n→ No NSFW Content');
assert.deepEqual(r.embed.footer, { text: 'Have Fun: Engage, enjoy', icon: '' });

// Both separators, every block, nested variables, text before {embed}.
r = parseEmbedScript('hello {user.mention} {embed}&v{title: Hi {user.name}}&v{url: https://x.test}$v{color: #ff91c2}&v{author: A && https://x.test/i.png && https://x.test}&v{field: n && v && inline}&v{field: n2 && v2}&v{timestamp}&v{thumbnail: https://x.test/t.png}&v{image: https://x.test/i.png}&v{button: link && Go && https://petto.sbs}');
assert.deepEqual(r.warnings, []);
assert.equal(r.content, 'hello {user.mention}');
assert.equal(r.embed.title, 'Hi {user.name}');
assert.equal(r.embed.color, 0xff91c2);
assert.deepEqual(r.embed.author, { name: 'A', icon: 'https://x.test/i.png', url: 'https://x.test' });
assert.deepEqual(r.embed.fields, [{ name: 'n', value: 'v', inline: true }, { name: 'n2', value: 'v2', inline: false }]);
assert.equal(r.embed.timestamp, true);
assert.deepEqual(r.buttons, [{ label: 'Go', url: 'https://petto.sbs', emoji: '', disabled: false }]);

// The text of the message can also be written with {message: ...}, and bot variables outside a block stay in the text.
r = parseEmbedScript('{message: hi {user.mention}}&v{embed}&v{title: x} pick {choose:a|b}');
assert.equal(r.content, 'hi {user.mention} pick {choose:a|b}');

// Buttons: other kinds become link buttons with a warning, and a button can be disabled.
r = parseEmbedScript('{embed}&v{button: green && Go && https://x.test && disabled}');
assert.equal(r.buttons[0].disabled, true);
assert.ok(r.warnings[0].includes('link button'));
assert.equal(parseEmbedScript('{embed}&v{button: Go && https://x.test}').buttons[0].label, 'Go');

// Problems are described, nothing throws.
assert.ok(parseEmbedScript('{embed}&v{title: x').warnings[0].includes('not closed'));
assert.ok(parseEmbedScript('}').warnings[0].includes('closing brace'));
assert.ok(parseEmbedScript('{embed}&v{color: nope}').warnings[0].includes('hex color'));
assert.ok(parseEmbedScript('{embed}&v{nonsense: x}').warnings[0].includes('not supported'));
assert.ok(parseEmbedScript('{embed}&v{field: only-a-name}').warnings[0].includes('field needs'));
assert.equal(parseEmbedScript('').embed, null);
assert.equal(parseEmbedScript(null).content, '');
assert.equal(parseEmbedScript('{embed}' + '&v{field: a && b}'.repeat(30)).embed.fields.length, 25);

// What gets saved: an embed alone keeps the shape the edit panel works with, text or buttons need the other shape.
let saved = toTemplateData(parseEmbedScript('{embed}&v{title: x}&v{field: a && b}'));
assert.equal(saved.editableInPanel, true);
assert.equal(saved.data.title, 'x');
assert.deepEqual(saved.data.fields, [{ name: 'a', value: 'b', inline: false }]);
saved = toTemplateData(parseEmbedScript('hi {embed}&v{title: x}'));
assert.equal(saved.editableInPanel, false);
assert.equal(saved.data.content, 'hi');
assert.equal(saved.data.embeds[0].title, 'x');

// `/embed create name code:`, with the database, the logger and the panel replaced.
function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const store = new Map();
stub('src/db/embedTemplates.js', {
  normalizeName: (name) => String(name).toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
  getTemplate: async (guildId, name) => store.get(name) ?? null,
  upsertTemplate: async (guildId, name, data) => { store.set(name, { name, data }); return { name, data }; },
  deleteTemplate: async () => true,
  listTemplates: async () => [],
});
stub('src/db/guilds.js', { ensureGuild: async () => ({ prefix: '!' }) });
stub('src/interactions/embedPanel.js', { renderPanel: async () => ({ content: 'PANEL' }) });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/embedVariables.js', { resolve: async (text) => text.replaceAll('{user}', 'Liam').replaceAll('{user.mention}', '@Liam').replaceAll('{newline}', '\n') });
stub('src/utils/cardService.js', { normalizeCardRef: (raw) => (raw && raw.name ? { name: String(raw.name), placement: 'default' } : null), renderCardForMessage: async () => null, CARD_FILE_NAME: 'card.png' });
const embedCommand = require('../src/commands/config/embed');

function interaction(options) {
  const replies = [];
  return {
    replies,
    options: { getString: (key) => options[key] ?? null, getSubcommand: () => 'create', getSubcommandGroup: () => null },
    user: { id: '1' },
    guild: { id: '9' },
    deferReply: async () => {},
    editReply: async (value) => { replies.push(value); },
  };
}
const ctx = {};

(async () => {
  // A good code is saved and shown.
  let i = interaction({ name: 'rules', code: '{embed}&v{title: Rules}&v{description: Hi {user}}&v{color: #ff91c2}' });
  await embedCommand.createFromCode(i, '9', 'rules', i.options.getString('code'), ctx);
  assert.equal(store.get('rules').data.title, 'Rules');
  assert.equal(store.get('rules').data.color, 0xff91c2);
  assert.ok(i.replies[0].embeds.length === 1, 'the result is shown right away');
  assert.ok(i.replies[0].content.includes('/embed edit'));

  // Message text and buttons use the dashboard shape and say where to edit.
  i = interaction({});
  await embedCommand.createFromCode(i, '9', 'withtext', 'hello {user.mention} {embed}&v{title: T}&v{button: link && Go && https://petto.sbs}', ctx);
  assert.equal(store.get('withtext').data.content, 'hello {user.mention}');
  assert.equal(store.get('withtext').data.buttons[0][0].url, 'https://petto.sbs');
  assert.ok(i.replies[0].content.includes('dashboard'));
  assert.ok(i.replies[0].components.length === 1);

  // The code is one line, so line breaks are {newline}. Blocks glued together or spread over lines read the same.
  i = interaction({});
  await embedCommand.createFromCode(i, '9', 'oneline', '{message: Hi {user}{newline}Second line}&v{embed}&v{title: T}&v{description: one{newline}two}', ctx);
  assert.equal(store.get('oneline').data.content, 'Hi {user}{newline}Second line', 'the variable stays in the saved text and is resolved when it is sent');
  assert.equal(i.replies[0].embeds[0].data.description, 'one\ntwo', 'the shown message turns {newline} into a line break');
  assert.ok(i.replies[0].content.endsWith('Hi Liam\nSecond line'));
  r = parseEmbedScript('{embed}\n&v{title: a}\n  &v{description: b}\n');
  assert.equal(r.embed.title, 'a'); assert.equal(r.embed.description, 'b'); assert.equal(r.content, '');

  // Plain text alone is a message with no embed, and a broken block is reported next to it.
  i = interaction({});
  await embedCommand.createFromCode(i, '9', 'plain', 'just a message {', ctx);
  assert.equal(store.get('plain').data.content, 'just a message');
  assert.ok(i.replies[0].content.includes('not closed'));

  // Nothing to build: nothing is saved and the answer says how to write it.
  i = interaction({});
  await embedCommand.createFromCode(i, '9', 'empty2', '{embed}', ctx);
  assert.ok(!store.has('empty2'));
  assert.ok(String(i.replies[0]).includes('nothing to show'));

  // Something Discord would refuse is not saved.
  i = interaction({});
  await embedCommand.createFromCode(i, '9', 'toolong', `{embed}&v{title: ${'x'.repeat(300)}}`, ctx);
  assert.ok(!store.has('toolong'), 'an embed Discord refuses must not be saved');
  assert.ok(String(i.replies[0]).includes('refuse'));

  // The command still offers the optional code and keeps the editor path.
  const create = embedCommand.data.toJSON().options.find((option) => option.name === 'create');
  assert.deepEqual(create.options.map((option) => [option.name, Boolean(option.required)]), [['name', true], ['code', false]]);
  console.log('Checked the embed code reader and /embed create code:.');
})().catch((error) => { console.error(error); process.exit(1); });
