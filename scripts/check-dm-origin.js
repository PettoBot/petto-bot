// Checks the line and the three buttons that every direct message of Petto carries (utils/dmOrigin.js), and the report of a message to the Petto team:
//   - no direct message is sent around the helper: every `.send(` to a user or a member in src goes through `sendDm` (with a short list of the
//     ones that are not messages to a person, each with its reason), and the net in `User#send` / `GuildMember#send` is there too;
//   - the three shapes (text, embeds, Components V2) get the line first (grey, small) and one row of three icon buttons; a message at a limit keeps
//     itself and drops the line or the buttons; names are escaped and clipped; custom ids stay under 100 characters;
//   - the buttons (about, delete, report) with fake interactions: private reply with what is public, only the bot's own messages in the person's own
//     direct messages, a polite refusal inside a server, delete only the message;
//   - the form (limits of Discord, 20 characters, category), the rate limit (3 an hour, one per message), the delivery to the team (a card with no
//     pings, a fallback to the database), the delete-after switch, the buttons of the team, and the three languages.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// The parts run one after the other: they share the table of reports.
const parts = [];
const section = (fn) => parts.push(fn);
function stub(relative, exports) {
  const resolved = require.resolve(path.join(ROOT, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const warnings = [];
stub('src/utils/logger.js', { info() {}, warn: (...args) => warnings.push(args.map(String).join(' ')), error() {}, debug() {} });

// An in-memory table of dm_reports: the same calls as src/db/dmReports.js, no database.
const table = [];
const fakeDb = {
  async recent(userId, seconds) {
    const since = Date.now() - seconds * 1000;
    const mine = table.filter((row) => row.reporter_id === userId && row.created_at.getTime() > since);
    return { total: mine.length, oldest: mine[0]?.created_at ?? null };
  },
  async add(report) {
    if (table.some((row) => row.message_id === report.messageId)) return null;
    const row = {
      id: table.length + 1, reporter_id: report.reporterId, reporter_tag: report.reporterTag, message_id: report.messageId, channel_id: report.channelId,
      guild_id: report.guildId, guild_name: report.guildName, kind: report.kind, category: report.category, details: report.details,
      message_text: report.messageText, deleted_dm: report.deletedDm, status: 'open', handled_by: null, created_at: new Date(),
    };
    table.push(row);
    return row;
  },
  async setDelivered(id, messageId) { table.find((row) => row.id === id).delivered_message_id = messageId; },
  async setDeleted() {},
  async handle(id, userId) { const row = table.find((item) => item.id === Number(id)); if (!row || row.status !== 'open') return null; Object.assign(row, { status: 'handled', handled_by: userId }); return row; },
  async reopen(id) { const row = table.find((item) => item.id === Number(id)); if (!row || row.status !== 'handled') return null; Object.assign(row, { status: 'open', handled_by: null }); return row; },
  async get(id) { return table.find((row) => row.id === Number(id)) ?? null; },
};
Object.assign(fakeDb, { SQL: {}, createStore: () => fakeDb });
stub('src/db/dmReports.js', fakeDb);

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, EmbedBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const i18n = require('../src/i18n');
const { EMOJI } = require('../src/utils/emojis');
const config = require('../src/config');
const origin = require('../src/utils/dmOrigin');
const dmReports = require('../src/utils/dmReports');
const handlers = require('../src/interactions/dmOrigin');
const { handleTeamButton } = require('../src/interactions/dmTeam');
const { dmCategoryOptions, DM_CATEGORY_VALUES, isDmReportCategory } = require('../src/utils/reportCategories');
const realDb = require('../src/db/dmReports');
assert.equal(realDb.add, fakeDb.add, 'the check runs on the stand-in of the table, never on the database');

const GUILD_ID = '123456789012345678';
const USER_ID = '223456789012345678';
const BOT_ID = '323456789012345678';
const guild = { id: GUILD_ID, name: 'Mossy Hollow', createdTimestamp: Date.UTC(2021, 4, 5), memberCount: 1234, iconURL: () => 'https://cdn.example/icon.png' };
const V2 = MessageFlags.IsComponentsV2;
const IDS = /^(dminfo|dmdel|dmrep):\d{1,25}:[a-z_]{1,16}$/;
const jsonOf = (value) => (typeof value?.toJSON === 'function' ? value.toJSON() : value);
const textOf = (payload) => JSON.stringify([payload.content ?? '', (payload.components ?? []).map(jsonOf), (payload.embeds ?? []).map(jsonOf)]);
const rowOf = (payload) => (payload.components ?? []).map(jsonOf).filter((c) => c.type === 1 && c.components.some((b) => String(b.custom_id ?? '').startsWith('dminfo:'))).at(0) ?? null;
const container = (text) => new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

function assertRow(payload, kind, label) {
  const row = rowOf(payload);
  assert.ok(row, `${label}: the row of buttons is there`);
  assert.equal(row.components.length, 3, `${label}: three buttons`);
  assert.deepEqual(row.components.map((b) => b.custom_id.split(':')[0]), ['dminfo', 'dmdel', 'dmrep'], `${label}: about, delete, report, in that order`);
  for (const button of row.components) {
    assert.equal(button.style, ButtonStyle.Secondary, `${label}: small secondary buttons`);
    assert.ok(button.emoji?.id && !button.label, `${label}: an icon and no text`);
    assert.match(button.custom_id, IDS, `${label}: ${button.custom_id} is a valid id`);
    assert.ok(button.custom_id.length < 100, `${label}: the id is under 100 characters`);
    assert.ok(button.custom_id.endsWith(`:${kind}`), `${label}: the id says why`);
  }
  assert.deepEqual(row.components.map((b) => `<:${b.emoji.name}:${b.emoji.id}>`), [EMOJI.INFO, EMOJI.DELETE, EMOJI.REPORT], `${label}: the emojis of Petto`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The icons are Petto's own application emojis, and every id fits.
section(() => {
  for (const key of ['INFO', 'DELETE', 'REPORT']) assert.match(EMOJI[key], /^<:(\w{2,32}):(\d{15,25})>$/, `EMOJI.${key} is a custom emoji of the application`);
  for (const kind of origin.KINDS) for (const action of ['info', 'delete', 'report']) {
    const id = origin.customId(action, { id: '999999999999999999999999' }, kind);
    assert.ok(id.length < 100, `${id} fits`);
    assert.deepEqual(origin.parseCustomId(id), { action, guildId: '999999999999999999999999', kind });
  }
  assert.equal(origin.parseCustomId(origin.customId('info', null, 'nonsense')).kind, 'notice', 'an unknown kind is "notice"');
  assert.equal(origin.parseCustomId(origin.customId('info', null, 'team')).guildId, null, 'no server is "0"');
  assert.equal(origin.parseCustomId('dminfo:abc:welcome'), null);
  assert.equal(origin.parseCustomId('dmrepm:1:welcome'), null, 'the id of the form is not the id of a button');
  for (const kind of origin.KINDS) for (const lang of i18n.LANGUAGES) assert.ok(i18n.CATALOGS[lang][`dm.kind.${kind}`] || kind === 'notice' && i18n.CATALOGS[lang]['dm.kind.notice'], `dm.kind.${kind} in ${lang}`);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The three shapes.
section(() => {
  // Plain text.
  let out = origin.decorate({ content: 'Welcome in!', allowedMentions: { parse: [] } }, { guild, kind: 'welcome', lang: 'en' });
  assert.equal(out.content, '-# From Mossy Hollow\nWelcome in!', 'the line is first, grey and small (subtext), and the text follows');
  assert.deepEqual(out.allowedMentions, { parse: [] }, 'the rest of the message is as it was');
  assertRow(out, 'welcome', 'text');
  out = origin.decorate('just a string', { guild, kind: 'notice', lang: 'en' });
  assert.equal(out.content, '-# From Mossy Hollow\njust a string', 'a string is a text');
  out = origin.decorate({ content: '' }, { guild, kind: 'notice', lang: 'en' });
  assert.equal(out.content, '-# From Mossy Hollow', 'no text: the line alone');

  // Embeds: the line goes in `content`, above the embed, and the row after the rows that were there.
  const embed = new EmbedBuilder().setTitle('Hi').setDescription('There');
  const existing = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mine').setLabel('Mine').setStyle(ButtonStyle.Primary));
  out = origin.decorate({ embeds: [embed], components: [existing] }, { guild, kind: 'form', lang: 'en' });
  assert.equal(out.content, '-# From Mossy Hollow');
  assert.equal(out.embeds[0], embed, 'the embed is untouched');
  assert.equal(out.components.length, 2);
  assert.equal(jsonOf(out.components[0]).components[0].custom_id, 'mine', 'the buttons of the message keep their place');
  assertRow(out, 'form', 'embeds');

  // Components V2: the line is a small text as the FIRST component (no content), the row is the last.
  out = origin.decorate({ components: [container('Body')], flags: V2, allowedMentions: { parse: [] } }, { guild, kind: 'sanction', lang: 'en' });
  assert.equal(out.content, undefined, 'a V2 message has no content');
  const parts = out.components.map(jsonOf);
  assert.deepEqual([parts[0].type, parts[0].content], [10, '-# From Mossy Hollow'], 'the line is the first component');
  assert.equal(parts[1].type, 17, 'the card follows');
  assert.equal(parts.at(-1).type, 1, 'the row is the last');
  assertRow(out, 'sanction', 'v2');
  assert.equal(out.flags, V2);

  // A message already decorated, and `plain`, are left alone; nothing is mutated.
  const input = { components: [container('x')], flags: V2 };
  const copy = JSON.stringify(input.components.map(jsonOf));
  origin.decorate(input, { guild, kind: 'notice' });
  assert.equal(input.components.length, 1, 'the payload that was given is not changed');
  assert.equal(JSON.stringify(input.components.map(jsonOf)), copy);
  const twice = origin.decorate(origin.decorate({ content: 'a' }, { guild, kind: 'notice', lang: 'en' }), { guild, kind: 'notice', lang: 'en' });
  assert.equal(twice.content, '-# From Mossy Hollow\na', 'a second pass adds nothing');
  assert.equal(twice.components.length, 1);
  assert.deepEqual(origin.decorate({ content: 'r' }, { plain: true }), { content: 'r', [origin.DONE]: true }, '`plain` is for the receipts');
  const tagged = origin.decorate(origin.withOrigin({ content: 'x' }, { guild, kind: 'ticket', lang: 'en' }), {});
  assert.ok(tagged.content.startsWith('-# From Mossy Hollow') && rowOf(tagged).components[0].custom_id.endsWith(':ticket'), 'a payload can carry its own origin');
  assert.ok(!Object.getOwnPropertySymbols(JSON.parse(JSON.stringify(tagged))).length, 'the marks are not for Discord');

  // No server: Petto itself.
  out = origin.decorate({ content: 'x' }, { guild: null, kind: 'team', lang: 'en' });
  assert.equal(out.content, '-# From Petto\nx');
  assert.ok(rowOf(out).components[0].custom_id.startsWith('dminfo:0:team'));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// A message at a limit keeps itself.
section(() => {
  const many = (count) => Array.from({ length: count }, (_, i) => new TextDisplayBuilder().setContent(`t${i}`));
  const v2 = (count, extra = {}) => ({ components: many(count), flags: V2, ...extra });
  const kinds = (out) => ({ line: jsonOf(out.components[0]).content?.startsWith('-# From'), row: Boolean(rowOf(out)), total: origin.measure(out.components).count });
  // 40 components: nothing fits; 39 and 36: the line only; 35: the line and the row (1 + 4); a card with children counts them all.
  let k = kinds(origin.decorate(v2(40), { guild, kind: 'notice', lang: 'en' }));
  assert.deepEqual([k.line, k.row, k.total], [false, false, 40], 'at 40 components the message is sent as it is');
  k = kinds(origin.decorate(v2(39), { guild, kind: 'notice', lang: 'en' }));
  assert.deepEqual([k.line, k.row, k.total], [true, false, 40], 'at 39 only the line fits');
  k = kinds(origin.decorate(v2(36), { guild, kind: 'notice', lang: 'en' }));
  assert.deepEqual([k.line, k.row, k.total], [true, false, 37], 'at 36 the row (4 components) does not fit: the line stays');
  k = kinds(origin.decorate(v2(35), { guild, kind: 'notice', lang: 'en' }));
  assert.deepEqual([k.line, k.row, k.total], [true, true, 40], 'at 35 both fit, exactly 40');
  const nested = new ContainerBuilder().addTextDisplayComponents(...many(37)); // the card and its 37 texts = 38 components
  k = kinds(origin.decorate({ components: [nested], flags: V2 }, { guild, kind: 'notice', lang: 'en' }));
  assert.ok(origin.measure([nested]).count === 38 && k.total <= 40, 'children count against the 40');
  assert.deepEqual([k.line, k.row], [true, false], 'a card with 38 components in it: the line, not the row');
  // 4000 characters of text.
  const full = new TextDisplayBuilder().setContent('x'.repeat(3995));
  let out = origin.decorate({ components: [full], flags: V2 }, { guild, kind: 'notice', lang: 'en' });
  assert.ok(origin.measure(out.components).count >= 1 && !JSON.stringify(out.components.map(jsonOf)).includes('From Mossy'), 'with no room for the line of text the line is the one that goes');
  assert.ok(rowOf(out), 'the row has no text, so it still fits');
  out = origin.decorate({ components: [new TextDisplayBuilder().setContent('x'.repeat(3800))], flags: V2 }, { guild, kind: 'notice', lang: 'en' });
  assert.ok(JSON.stringify(out.components.map(jsonOf)).includes('From Mossy') && rowOf(out), 'with room both are there');
  // A message with five rows: no room for a row, the line stays; 2000 characters: no room for the line, the row stays.
  const rows = Array.from({ length: 5 }, (_, i) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`r${i}`).setLabel('b').setStyle(ButtonStyle.Primary)));
  out = origin.decorate({ content: 'hi', components: rows }, { guild, kind: 'notice', lang: 'en' });
  assert.equal(out.components.length, 5, 'five rows: the buttons are dropped, never the message');
  assert.ok(out.content.startsWith('-# From Mossy Hollow\nhi'));
  out = origin.decorate({ content: 'y'.repeat(2000) }, { guild, kind: 'notice', lang: 'en' });
  assert.equal(out.content.length, 2000, '2000 characters of text: the line is dropped, the text is whole');
  assert.ok(rowOf(out), 'and the buttons stay');
  out = origin.decorate({ content: 'y'.repeat(2000), components: rows }, { guild, kind: 'notice', lang: 'en' });
  assert.equal(out.content, 'y'.repeat(2000), 'both limits: the message goes as it was');
  assert.equal(out.components.length, 5);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Names: escaped, one line, clipped, never a ping or a link.
section(() => {
  const name = '**@everyone** [click](http://evil.example) <@123456789012345678> https://x.example\nsecond line `code` __u__ ~~s~~ ||spoiler|| discord.gg/abc';
  const line = origin.originText({ id: GUILD_ID, name }, 'en');
  assert.ok(line.startsWith('-# From '));
  assert.ok(!line.includes('\n'), 'one line');
  assert.ok(!/@everyone/.test(line) && !/<@/.test(line), 'no mention can form');
  assert.ok(!/\]\(http/.test(line) && !/https?:\/\//.test(line), 'no link can form');
  assert.ok(!/(^|[^\\])\*\*/.test(line.slice(8)) && !/(^|[^\\])\|\|/.test(line.slice(8)), 'markdown is escaped');
  assert.ok(!/discord\.gg/i.test(line), 'no invite');
  assert.ok([...origin.safeName('é'.repeat(200))].length <= 60, 'clipped to 60');
  assert.equal(origin.safeName('   '), '', 'blank is nothing');
  assert.equal(origin.originText({ id: GUILD_ID, name: '   ' }, 'en'), '-# From Petto', 'a server with no name is Petto');
  const out = origin.decorate({ content: 'x' }, { guild: { id: GUILD_ID, name }, kind: 'notice', lang: 'en' });
  assert.equal(out.allowedMentions, undefined, 'the name does not touch the mentions policy');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The three languages: the line, the form.
section(() => {
  i18n.setCachedGuildLanguage(GUILD_ID, 'es');
  assert.equal(origin.decorate({ content: 'x' }, { guild, kind: 'welcome' }).content, '-# De Mossy Hollow\nx', 'the language of the server, when the message does not say');
  i18n.setCachedGuildLanguage(GUILD_ID, 'pt-BR');
  assert.equal(origin.decorate({ content: 'x' }, { guild, kind: 'welcome' }).content, '-# De Mossy Hollow\nx');
  assert.equal(origin.originText(null, 'pt-BR'), '-# Do Petto');
  assert.equal(origin.decorate({ content: 'x' }, { guild, kind: 'welcome', lang: 'en' }).content, '-# From Mossy Hollow\nx', 'a language given wins');
  i18n.setCachedGuildLanguage(GUILD_ID, 'en');

  for (const lang of i18n.LANGUAGES) {
    const modal = handlers.buildReportModal({ guildId: GUILD_ID, kind: 'welcome', messageId: '423456789012345678', lang }).toJSON();
    assert.ok(modal.title.length <= 45 && modal.title.length > 0, `${lang}: the title has at most 45 characters`);
    assert.ok(modal.custom_id.length < 100, `${lang}: the id of the form fits`);
    assert.equal(modal.components.length, 5, `${lang}: five components (the notice, the paragraph, the three fields)`);
    assert.deepEqual(modal.components.map((c) => c.type), [10, 10, 18, 18, 18], `${lang}: two texts and three labels, like the form it follows`);
    const [notice, apart, category, details, remove] = modal.components;
    assert.ok(notice.content.includes('Petto') && !/Mossy/.test(notice.content), `${lang}: the notice says who gets the form`);
    assert.match(apart.content, /^\*\*.+\*\*\n/, `${lang}: the paragraph starts with the bold sentence`);
    assert.ok(/Petto/.test(apart.content), `${lang}: it says who reads it`);
    for (const label of [category, details, remove]) {
      assert.ok(label.label.length <= 45 && label.label.length > 0, `${lang}: label "${label.label}" has at most 45 characters`);
      assert.ok(!label.description || label.description.length <= 100, `${lang}: the description fits`);
    }
    assert.equal(category.component.type, 3, `${lang}: a menu`);
    assert.equal(category.component.options.length, 9);
    assert.equal(category.component.options[0].value, 'dm_abuse', `${lang}: the DM category comes first`);
    for (const option of category.component.options) assert.ok(option.label.length <= 100 && option.description.length <= 100 && option.emoji, `${lang}: option ${option.value}`);
    assert.equal(category.component.min_values, 1);
    assert.equal(category.component.max_values, 1);
    assert.equal(details.component.type, 4, `${lang}: a text`);
    assert.equal(details.component.style, 2, `${lang}: a long one`);
    assert.deepEqual([details.component.min_length, details.component.max_length, details.component.required], [20, 1000, true], `${lang}: 20 to 1000 characters, required`);
    assert.ok(details.component.placeholder.length <= 100);
    assert.equal(remove.component.type, 23, `${lang}: a checkbox`);
    assert.ok(remove.component.custom_id === handlers.FIELDS.remove);
    if (lang !== 'en') assert.notEqual(modal.title, 'Report DM to Petto Staff', `${lang}: it is translated`);
  }
  assert.deepEqual(DM_CATEGORY_VALUES.slice(1), ['spam', 'harassment', 'hate', 'nsfw', 'scam', 'threats', 'impersonation', 'other'], 'the categories of the server reports follow');
  assert.ok(isDmReportCategory('dm_abuse') && !isDmReportCategory('x') && !require('../src/utils/reportCategories').isReportCategory('dm_abuse'), 'the new category is not one of `/report send`');
  assert.equal(dmCategoryOptions('es').length, 9);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// `sendDm` and the net.
section(async () => {
  const sent = [];
  const member = { guild, send: async (body) => { sent.push(body); return { id: 'm1' }; } };
  assert.equal(await origin.sendDm(null, { content: 'x' }), null, 'nobody to send to: nothing');
  await origin.sendDm(member, { content: 'hello' }, { kind: 'welcome' });
  assert.ok(sent[0].content.startsWith('-# From Mossy Hollow\nhello'), 'a member brings its own server');
  assertRow(sent[0], 'welcome', 'member');
  const user = { send: async (body) => { sent.push(body); return { id: 'm2' }; } };
  await origin.sendDm(user, { content: 'hello' }, { guild, kind: 'ticket' });
  assert.ok(sent[1].content.startsWith('-# From Mossy Hollow') && rowOf(sent[1]).components[0].custom_id.endsWith(':ticket'), 'a user gets the server it is told');
  await origin.sendDm(user, { content: 'hello' });
  assert.ok(sent[2].content.startsWith('-# From Petto'), 'no server known: Petto');
  await origin.sendDm(user, { content: 'receipt' }, { plain: true });
  assert.equal(sent[3].content, 'receipt', 'a receipt is not decorated');
  assert.equal(origin.decorate(origin.withOrigin({ content: 'x' }, { guild, kind: 'sanction' }), {}).components.length, 1);
  assert.equal(Object.getOwnPropertySymbols(sent[3]).includes(origin.ORIGIN), false, 'the mark of the origin never goes to Discord');

  // The net: a class stand-in for User and GuildMember, hooked once.
  const log = [];
  class FakeUser { async send(body) { log.push(body); return { id: 'u' }; } }
  class FakeMember { constructor() { this.guild = guild; } async send(body) { log.push(body); return { id: 'g' }; } }
  origin.installDmOrigin({ User: FakeUser, GuildMember: FakeMember });
  origin.installDmOrigin({ User: FakeUser, GuildMember: FakeMember });
  await new FakeUser().send({ content: 'raw' });
  assert.ok(log[0].content.startsWith('-# From Petto\nraw') && rowOf(log[0]), 'a raw `User#send` still gets the line and the buttons (from Petto: the server is not known)');
  await new FakeMember().send('raw member');
  assert.ok(log[1].content.startsWith('-# From Mossy Hollow\nraw member'), 'a raw `GuildMember#send` says its server');
  assert.equal(log[1].components.length, 1, 'the net runs once (it was installed twice)');
  await origin.sendDm(new FakeMember(), { content: 'through the helper' }, { kind: 'level' });
  assert.equal(log[2].components.length, 1, 'a message that went through `sendDm` is not decorated again by the net');
  assert.ok(rowOf(log[2]).components[0].custom_id.endsWith(':level'));
  await new FakeUser().send(origin.withOrigin({ content: 'tagged' }, { guild, kind: 'sanction' }));
  assert.ok(log[3].content.startsWith('-# From Mossy Hollow') && rowOf(log[3]).components[0].custom_id.endsWith(':sanction'), 'a tagged payload is read by the net too');

  // A failure of the decoration never loses the message.
  const lost = [];
  await origin.sendDm({ send: async (body) => { lost.push(body); } }, { get content() { throw new Error('boom'); }, embeds: [] }, { guild }).catch(() => {});
  assert.equal(lost.length, 1, 'a message whose decoration failed is still sent');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The wiring: every direct message of the code goes through the helper; the buttons are routed; the handlers never assume a server.
section(() => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'public' ? [] : walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
  // Who a `.send(` is to: the words right before it. Persons: user, member, author, owner, inviter, opener, applicant, reporter... or a chat (`dm`).
  const PERSON = /(?:^|[^\w])(user|member|author|owner|ownerUser|inviter|opener|applicant|reporter|recipient|winner|dm|dmChannel|moderator)\??$/;
  // Not a message to a person, each with its reason.
  const ALLOWED = new Map([
    ['src/utils/dmOrigin.js', 'the helper itself: this is where the message is sent'],
  ]);
  const found = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (ALLOWED.has(relative)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const pattern = /\??\.send\(/g;
    let match;
    while ((match = pattern.exec(source))) {
      const before = source.slice(Math.max(0, match.index - 80), match.index).replace(/\s*\n\s*/g, '');
      const after = source.slice(match.index + match[0].length, match.index + match[0].length + 40);
      if (PERSON.test(before) || /^(await )?sanctionDM\(/.test(after)) found.push(`${relative}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(found, [], `these send a direct message around \`sendDm\`:\n  ${found.join('\n  ')}`);

  // The buttons are routed before anything else, and the handler does not read the server or the member of the interaction to act.
  const router = fs.readFileSync(path.join(ROOT, 'src/events/interactionCreate.js'), 'utf8');
  assert.match(router, /handleDmOriginButton/, 'the buttons are routed');
  assert.match(router, /handleDmReportModal/, 'the form is routed');
  assert.match(router, /handleDmTeamButton/, 'the buttons of the team are routed');
  assert.ok(router.indexOf('await handleDmOriginButton(') < router.indexOf('await handleCodeCommandComponent('), 'they are the first thing the router looks at');
  assert.match(fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8'), /installDmOrigin\(\)/, 'the net is installed at startup');
  const handlerSource = fs.readFileSync(path.join(ROOT, 'src/interactions/dmOrigin.js'), 'utf8');
  assert.ok(!/interaction\.(guild|member)\.[a-z]/i.test(handlerSource), 'the handlers do not dereference a server or a member');
  assert.ok(!/PermissionFlagsBits|permissions\.has/.test(handlerSource), 'and decide nothing with permissions');
  const schema = fs.readFileSync(path.join(ROOT, 'src/db/schema.sql'), 'utf8');
  assert.match(schema, /create table if not exists dm_reports \(/, 'the table is in schema.sql');
  assert.match(schema, /message_id\s+text not null unique/, 'one report for each message');
  assert.match(schema, /alter table dm_reports enable row level security;/, 'closed to everyone but the bot');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The buttons, with fake interactions.
function fake({ customId, message, inGuild = false, user = { id: USER_ID }, locale = 'en-US', channel, fields, showModalSpy } = {}) {
  const calls = { replies: [], updates: [], follow: [], modal: null, deferred: false, edited: [] };
  const dm = channel === undefined ? { id: 'dm1', type: 1, recipientId: user.id, messages: { fetch: async (id) => (message?.id === id ? message : null) } } : channel;
  const interaction = {
    customId, user, locale, message, channel: dm, channelId: dm?.id ?? 'dm1', fields,
    client: { user: { id: BOT_ID }, guilds: { cache: new Map([[GUILD_ID, guild]]) }, channels: { fetch: async () => null } },
    guildId: inGuild ? GUILD_ID : null, guild: inGuild ? guild : null, member: inGuild ? { id: user.id } : null,
    replied: false, deferred: false,
    reply: async (body) => { calls.replies.push(body); interaction.replied = true; },
    deferReply: async () => { calls.deferred = true; interaction.deferred = true; },
    editReply: async (body) => { calls.edited.push(body); },
    deferUpdate: async () => { calls.deferred = true; },
    followUp: async (body) => { calls.follow.push(body); },
    showModal: async (modal) => { calls.modal = modal; showModalSpy?.(modal); },
    update: async (body) => { calls.updates.push(body); },
  };
  return { interaction, calls };
}
const botMessage = (extra = {}) => ({ id: '423456789012345678', channelId: 'dm1', author: { id: BOT_ID }, content: '-# From Mossy Hollow\nYou were banned. https://evil.example/x discord.gg/abc', embeds: [], components: [], deleted: 0, async delete() { this.deleted += 1; }, ...extra });

section(async () => {
  // About: a reply with what is public, in the language of the person.
  let message = botMessage();
  let { interaction, calls } = fake({ customId: origin.customId('info', guild, 'sanction'), message });
  await handlers.handleButton(interaction);
  assert.equal(calls.replies.length, 1, 'one reply');
  let reply = calls.replies[0];
  const text = JSON.stringify(reply.components.map(jsonOf));
  for (const wanted of ['Mossy Hollow', GUILD_ID, '1234', String(Math.floor(guild.createdTimestamp / 1000)), 'moderation action']) assert.ok(text.includes(wanted), `the reply shows ${wanted}`);
  assert.ok(text.includes('on behalf of that server'), 'it says Petto sent it on behalf of the server');
  assert.ok(text.includes('https://cdn.example/icon.png'), 'with the icon of the server');
  assert.ok(reply.flags & V2, 'a card');
  assert.deepEqual(reply.allowedMentions, { parse: [] }, 'no mention can notify');
  assert.ok(JSON.stringify(reply.components.map(jsonOf)).includes('dmdel:'), 'the reply can be deleted with the bin');
  assert.ok(!(reply.flags & MessageFlags.Ephemeral) || true, 'ephemeral is not possible in direct messages: it is a message the person can delete');
  assert.ok(!/invite|staff member|moderator:|prefix/i.test(text.replace(/moderation action|the staff of that server|staff/gi, '')), 'nothing private about the server');
  assert.ok(text.includes('/dmonjoin') === false, 'a sanction has no switch of its own');
  // The kinds that have a switch say where it is; the ones that have not, say so.
  ({ interaction, calls } = fake({ customId: origin.customId('info', guild, 'welcome'), message }));
  await handlers.handleButton(interaction);
  assert.ok(JSON.stringify(calls.replies[0].components.map(jsonOf)).includes('/dmonjoin disable'), 'the join message names its command');
  // Spanish, Portuguese.
  for (const [locale, word] of [['es-ES', 'Servidor'], ['pt-BR', 'Servidor']]) {
    ({ interaction, calls } = fake({ customId: origin.customId('info', guild, 'ticket'), message, locale }));
    await handlers.handleButton(interaction);
    assert.ok(JSON.stringify(calls.replies[0].components.map(jsonOf)).includes(word), `${locale}: in the language of the person`);
  }
  // Petto itself (no server) and a server Petto left.
  ({ interaction, calls } = fake({ customId: origin.customId('info', null, 'team'), message }));
  await handlers.handleButton(interaction);
  assert.ok(JSON.stringify(calls.replies[0].components.map(jsonOf)).includes('Petto itself'), 'a message from Petto says so');
  ({ interaction, calls } = fake({ customId: origin.customId('info', { id: '999999999999999999' }, 'welcome'), message }));
  await handlers.handleButton(interaction);
  assert.ok(JSON.stringify(calls.replies[0].components.map(jsonOf)).includes('not in that server any more'), 'a server that is gone: nothing more is shown');

  // The refusals.
  ({ interaction, calls } = fake({ customId: origin.customId('info', guild, 'welcome'), message, inGuild: true }));
  await handlers.handleButton(interaction);
  assert.match(JSON.stringify(calls.replies[0].components.map(jsonOf)), /only work in your direct messages/, 'inside a server: a polite refusal');
  assert.ok(!JSON.stringify(calls.replies[0]).includes('Mossy'), 'and nothing of the server');
  ({ interaction, calls } = fake({ customId: origin.customId('delete', guild, 'welcome'), message, inGuild: true }));
  await handlers.handleButton(interaction);
  assert.equal(message.deleted, 0, 'a message is not deleted from a server channel');
  ({ interaction, calls } = fake({ customId: origin.customId('delete', guild, 'welcome'), message: botMessage({ author: { id: '777777777777777777' } }) }));
  await handlers.handleButton(interaction);
  assert.match(JSON.stringify(calls.replies[0].components.map(jsonOf)), /not a message that Petto sent/, 'only the messages of Petto');
  const foreign = botMessage();
  ({ interaction, calls } = fake({ customId: origin.customId('delete', guild, 'welcome'), message: foreign, channel: { id: 'dm1', type: 1, recipientId: '888888888888888888' } }));
  await handlers.handleButton(interaction);
  assert.equal(foreign.deleted, 0, 'the chat of another person is not theirs');
  ({ interaction, calls } = fake({ customId: 'dminfo:zzz', message }));
  await handlers.handleButton(interaction);
  assert.match(JSON.stringify(calls.replies[0].components.map(jsonOf)), /not valid any more/, 'an id that does not parse');
  // A partial channel (no recipient known): the chat is looked up, and must be this one.
  const partial = botMessage();
  ({ interaction, calls } = fake({ customId: origin.customId('delete', guild, 'welcome'), message: partial, channel: null }));
  interaction.user.createDM = async () => ({ id: 'dm1' });
  await handlers.handleButton(interaction);
  assert.equal(partial.deleted, 1, 'a chat that is not cached is found through the person');

  // Delete: that message and nothing else.
  const mine = botMessage();
  ({ interaction, calls } = fake({ customId: origin.customId('delete', guild, 'welcome'), message: mine }));
  await handlers.handleButton(interaction);
  assert.equal(mine.deleted, 1, 'the message is deleted, once');
  assert.ok(calls.deferred && calls.replies.length === 0 && calls.follow.length === 0, 'nothing else is said');
  const stuck = botMessage({ async delete() { throw new Error('Unknown Message'); } });
  ({ interaction, calls } = fake({ customId: origin.customId('delete', guild, 'welcome'), message: stuck }));
  await handlers.handleButton(interaction);
  assert.match(JSON.stringify(calls.follow[0].components.map(jsonOf)), /could not be deleted/, 'a message that cannot be deleted is said');

  // Report: opens the form (the id says which message).
  ({ interaction, calls } = fake({ customId: origin.customId('report', guild, 'form'), message }));
  await handlers.handleButton(interaction);
  assert.ok(calls.modal, 'the form opens');
  assert.equal(calls.modal.toJSON().custom_id, `dmrepm:${GUILD_ID}:form:${message.id}`);
  ({ interaction, calls } = fake({ customId: origin.customId('report', guild, 'form'), message, inGuild: true }));
  await handlers.handleButton(interaction);
  assert.equal(calls.modal, null, 'not from a server');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The report: the form, the limits, the team, the fallback, the switch.
section(async () => {
  const sentToTeam = [];
  const teamChannel = { isTextBased: () => true, send: async (payload) => { sentToTeam.push(payload); return { id: `card${sentToTeam.length}` }; } };
  const clientWith = (channelOf) => ({ user: { id: BOT_ID }, guilds: { cache: new Map([[GUILD_ID, guild]]) }, channels: { fetch: async (id) => channelOf(id) } });
  const fields = (details, { category = 'dm_abuse', remove = false } = {}) => ({
    getStringSelectValues: () => (category === null ? [] : [category]),
    getTextInputValue: () => details,
    getCheckbox: () => remove,
  });
  const submit = async ({ message, details, category, remove, user, client, channelOf = () => teamChannel }) => {
    const { interaction, calls } = fake({ customId: `dmrepm:${GUILD_ID}:welcome:${message.id}`, message, user, fields: fields(details, { category, remove }) });
    interaction.client = client ?? clientWith(channelOf);
    interaction.client.user = { id: BOT_ID };
    interaction.client.guilds = { cache: new Map([[GUILD_ID, guild]]) };
    await handlers.handleModal(interaction);
    return calls;
  };
  const longText = 'This server sends me messages I never asked for, again and again.';
  config.opsChannels.dmReports = '555555555555555555';

  // A report: stored, delivered to the team, receipt to the person, the message stays.
  let one = botMessage({ id: '500000000000000001' });
  let calls = await submit({ message: one, details: longText });
  assert.equal(table.length, 1, 'stored');
  assert.deepEqual([table[0].reporter_id, table[0].guild_id, table[0].guild_name, table[0].kind, table[0].category], [USER_ID, GUILD_ID, 'Mossy Hollow', 'welcome', 'dm_abuse'], 'who, where from, why, what');
  assert.equal(sentToTeam.length, 1, 'the team got a card');
  const card = JSON.stringify(sentToTeam[0].components.map(jsonOf));
  for (const wanted of ['DM report #1', 'Mossy Hollow', GUILD_ID, 'welcome', USER_ID, 'dm_abuse', 'You were banned', longText, 'dmteam:done:1']) assert.ok(card.includes(wanted), `the card has ${wanted}`);
  assert.deepEqual(sentToTeam[0].allowedMentions, { parse: [] }, 'the card cannot ping');
  assert.ok(!/https?:\/\/evil|discord\.gg/i.test(card) && card.includes('hxxps://evil[.]example/x') && card.includes('discord[.]gg/abc'), 'links are defanged in the card');
  assert.ok(sentToTeam[0].flags & V2);
  assert.equal(table[0].delivered_message_id, 'card1');
  assert.equal(one.deleted, 0, 'the DM stays when the switch is off');
  assert.ok(calls.deferred && /#1/.test(JSON.stringify(calls.edited[0].components.map(jsonOf))) && /moderators of the server did not get it/.test(JSON.stringify(calls.edited[0].components.map(jsonOf))), 'the person is told, in a short receipt');
  assert.ok(!/From Mossy/.test(JSON.stringify(calls.edited[0])), 'the receipt carries no origin line or buttons');
  assert.ok(!card.includes('@everyone') && !/<@&?\d/.test(card), 'no mention in the card');

  // A mention in the DM or the details cannot notify (the policy is `parse: []` and the card has no pill).
  const noisy = botMessage({ id: '500000000000000002', content: '@everyone <@&123456789012345678> hello' });
  await submit({ message: noisy, details: `${longText} @everyone @here` });
  assert.deepEqual(sentToTeam[1].allowedMentions, { parse: [] });

  // The switch: the DM is deleted only when it is on, and only after the report is stored.
  const gone = botMessage({ id: '500000000000000003' });
  calls = await submit({ message: gone, details: longText, remove: true });
  assert.equal(gone.deleted, 1, 'switch on: deleted');
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /deleted from your chat/);
  assert.equal(table.length, 3);

  // Limits of the text and the category: nothing stored, nothing deleted.
  const refused = botMessage({ id: '500000000000000004' });
  calls = await submit({ message: refused, details: 'too short', remove: true });
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /at least 20 characters/, 'under 20 characters');
  calls = await submit({ message: refused, details: 'x'.repeat(1001), remove: true });
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /at least 20 characters/, 'over 1000 characters');
  calls = await submit({ message: refused, details: `${' '.repeat(30)}short${' '.repeat(30)}`, remove: true });
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /at least 20 characters/, 'spaces do not count');
  calls = await submit({ message: refused, details: longText, category: 'made-up', remove: true });
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /Pick one of the options/, 'a category that is not in the list');
  calls = await submit({ message: refused, details: longText, category: null, remove: true });
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /Pick one of the options/, 'no category');
  assert.equal(table.length, 3, 'nothing was stored');
  assert.equal(refused.deleted, 0, 'and nothing was deleted');
  for (const category of DM_CATEGORY_VALUES) {
    const ok = await dmReports.submitDmReport({ client: clientWith(() => teamChannel), user: { id: `9${DM_CATEGORY_VALUES.indexOf(category)}`.padEnd(18, '0'), tag: 'x' }, message: botMessage({ id: `60000000000000000${DM_CATEGORY_VALUES.indexOf(category)}` }), guild, kind: 'welcome', category, details: longText }, { limiter: dmReports.createLimiter() });
    assert.ok(ok.ok, `${category} is accepted`);
  }
  table.length = 3;

  // One report for each message; three an hour for each person.
  calls = await submit({ message: one, details: longText });
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /already reported this message/, 'the same message twice');
  assert.equal(table.length, 3);
  calls = await submit({ message: botMessage({ id: '500000000000000005' }), details: longText });
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /already sent 3 reports/, 'the fourth in an hour is refused');
  assert.equal(table.length, 3);
  const other = await submit({ message: botMessage({ id: '500000000000000006' }), details: longText, user: { id: '999999999999999990', tag: 'other#0' } });
  assert.match(JSON.stringify(other.edited[0].components.map(jsonOf)), /#4/, 'the limit is for each person');
  // The window: in memory and in the database (a restart forgets the memory, not the table).
  let now = 1_000_000;
  const limiter = dmReports.createLimiter({ now: () => now });
  assert.ok(limiter.claim('u', 'a').ok && limiter.claim('u', 'b').ok && limiter.claim('u', 'c').ok);
  assert.deepEqual([limiter.claim('u', 'd').ok, limiter.claim('u', 'd').reason], [false, 'limit']);
  assert.equal(limiter.claim('u', 'a').reason, 'duplicate', 'a message is claimed once');
  now += 3_600_001;
  assert.ok(limiter.claim('u', 'd').ok, 'an hour later there is room');
  limiter.release('u', 'd');
  assert.ok(limiter.claim('u', 'd').ok, 'a report that was not stored gives its place back');
  const reporter = '777777777777777770';
  for (let i = 0; i < 3; i += 1) table.push({ id: 100 + i, reporter_id: reporter, message_id: `old${i}`, created_at: new Date(Date.now() - 600_000), status: 'open' });
  const restarted = await dmReports.submitDmReport({ client: clientWith(() => teamChannel), user: { id: reporter, tag: 'r' }, message: botMessage({ id: '500000000000000007' }), guild, kind: 'welcome', category: 'spam', details: longText }, { limiter: dmReports.createLimiter() });
  assert.deepEqual([restarted.ok, restarted.reason, restarted.max], [false, 'limit', 3], 'the table remembers what the memory forgot');
  assert.ok(restarted.minutes >= 1 && restarted.minutes <= 60);
  table.length = 3;

  // Without a channel, or when Discord refuses the card: stored, a warning, the person is still thanked, nothing is lost.
  config.opsChannels.dmReports = null;
  warnings.length = 0;
  const stored = botMessage({ id: '500000000000000008' });
  calls = await submit({ message: stored, details: longText, user: { id: '999999999999999991', tag: 'x#0' }, remove: true });
  assert.equal(table.length, 4, 'stored without a channel');
  assert.equal(table[3].delivered_message_id, undefined);
  assert.ok(warnings.some((line) => /PETTO_DM_REPORTS_CHANNEL_ID is not set/.test(line)), 'and a warning says why');
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /report #4/, 'the person is thanked all the same');
  assert.equal(stored.deleted, 1, 'the report is stored, so the DM can go');
  config.opsChannels.dmReports = '555555555555555555';
  warnings.length = 0;
  calls = await submit({ message: botMessage({ id: '500000000000000009' }), details: longText, user: { id: '999999999999999992', tag: 'y#0' }, channelOf: () => { throw new Error('Missing Access'); } });
  assert.equal(table.length, 5, 'stored when the card cannot be sent');
  assert.ok(warnings.some((line) => /card could not be sent/.test(line)));
  // The database being down: nothing is said to have been sent, and nothing is deleted.
  const downMessage = botMessage({ id: '500000000000000010' });
  const real = fakeDb.add;
  fakeDb.add = async () => { throw new Error('down'); };
  calls = await submit({ message: downMessage, details: longText, user: { id: '999999999999999993', tag: 'z#0' }, remove: true });
  fakeDb.add = real;
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /could not be saved/);
  assert.equal(downMessage.deleted, 0, 'not stored: not deleted');
  assert.ok(dmReports.createLimiter().claim('z', 'm').ok);

  // A report from a server channel, about a message that is not Petto's or not theirs.
  const inGuild = fake({ customId: `dmrepm:${GUILD_ID}:welcome:500000000000000011`, message: botMessage({ id: '500000000000000011' }), inGuild: true, fields: fields(longText) });
  await handlers.handleModal(inGuild.interaction);
  assert.match(JSON.stringify(inGuild.calls.replies[0].components.map(jsonOf)), /only work in your direct messages/);
  const notBot = botMessage({ id: '500000000000000012', author: { id: '666666666666666666' } });
  calls = await submit({ message: notBot, details: longText, user: { id: '999999999999999994', tag: 'q#0' } });
  assert.match(JSON.stringify(calls.edited[0].components.map(jsonOf)), /not a message that Petto sent/);
  assert.ok(!table.some((row) => row.message_id === notBot.id), 'a message that is not Petto\'s is not reported');

  // The text of a message of components (V2), embeds and files is read for the team.
  const rich = botMessage({ content: '', embeds: [new EmbedBuilder().setTitle('Title').setDescription('Embedded words').addFields({ name: 'F', value: 'v' })], components: [container('Card words')] });
  const snapshot = dmReports.snapshotOf(rich);
  for (const wanted of ['Title', 'Embedded words', 'F: v', 'Card words']) assert.ok(snapshot.includes(wanted), `the team can read ${wanted}`);
  assert.ok(dmReports.snapshotOf({ content: '```x``` '.repeat(400) }).length <= 1200, 'long text is clipped');
  assert.ok(!dmReports.snapshotOf({ content: '```a```' }).includes('```'), 'a code block cannot break the card');

  // The card's own limits: whatever the sizes, it fits in a V2 message.
  const huge = dmReports.teamCard({ id: 9, category: 'dm_abuse', kind: 'welcome', guild_id: GUILD_ID, guild_name: 'n'.repeat(500), reporter_id: USER_ID, reporter_tag: 't'.repeat(500), message_text: 'm'.repeat(5000), details: 'd'.repeat(5000), status: 'open', created_at: new Date() });
  assert.ok(origin.measure(huge.components).count <= 40 && JSON.stringify(huge.components.map(jsonOf)).length < 6000);
  assert.ok(origin.measure(huge.components).text <= 4000, 'at most 4000 characters of text');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The buttons of the team: only the Petto team, once.
section(async () => {
  const reportRow = { id: 41, category: 'spam', kind: 'welcome', guild_id: GUILD_ID, guild_name: 'Mossy Hollow', reporter_id: USER_ID, reporter_tag: 'a#0', message_text: 'x', details: 'y'.repeat(30), status: 'open', created_at: new Date(), deleted_dm: false };
  table.push(reportRow);
  const press = async (id, customId) => {
    const { interaction, calls } = fake({ customId, user: { id } });
    interaction.inGuild = () => true;
    await handleTeamButton(interaction, { db: fakeDb });
    return calls;
  };
  let calls = await press('111111111111111111', 'dmteam:done:41');
  assert.match(calls.replies[0].content, /Only the Petto team/, 'a stranger cannot mark it');
  assert.equal(reportRow.status, 'open');
  const operator = config.ownerId;
  calls = await press(operator, 'dmteam:done:41');
  assert.equal(reportRow.status, 'handled');
  assert.match(JSON.stringify(calls.updates[0].components.map(jsonOf)), /Handled by[\s\S]*Reopen/, 'the card shows who handled it, with a button to reopen');
  assert.deepEqual(calls.updates[0].allowedMentions, { parse: [] });
  calls = await press(operator, 'dmteam:done:41');
  assert.match(calls.replies[0].content, /already handled/, 'handled once');
  calls = await press(operator, 'dmteam:open:41');
  assert.equal(reportRow.status, 'open');
  calls = await press(operator, 'dmteam:bad');
  assert.match(calls.replies[0].content, /not valid/);
  table.length = 0;
});

// The statements of the table: one report for each message, counted by person and time.
section(async () => {
  const file = require.resolve('../src/db/dmReports.js');
  const stand = require.cache[file];
  delete require.cache[file];
  stub('src/db/postgres.js', { getPrimaryPool: () => ({ query: async () => ({ rows: [] }) }) });
  const { createStore, SQL } = require('../src/db/dmReports.js');
  require.cache[file] = stand;
  const calls = [];
  const store = createStore(async (sql, params) => { calls.push({ sql, params }); return { rows: sql === SQL.recentCount ? [{ total: 2 }] : sql === SQL.oldestRecent ? [{ created_at: '2026-01-01T00:00:00Z' }] : [{ id: 1 }] }; });
  assert.match(SQL.insert, /on conflict \(message_id\) do nothing/, 'a second report of a message inserts nothing');
  assert.match(SQL.handle, /where id = \$1 and status = 'open'/, 'two people cannot both handle it');
  await store.add({ reporterId: 'r', messageId: 'm', channelId: 'c', kind: 'welcome', category: 'spam', details: 'd' });
  assert.equal(calls[0].params.length, 11);
  const recent = await store.recent('r', 3600);
  assert.deepEqual([recent.total, recent.oldest instanceof Date], [2, true]);
});

(async () => {
  for (const part of parts) await part();
  console.log('check-dm-origin: ok');
})().catch((error) => { console.error(error); process.exit(1); });
