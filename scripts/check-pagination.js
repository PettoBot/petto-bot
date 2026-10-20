// Checks paginated messages (`!pagination`): the records with an in-memory database, the ids of the buttons, page numbers kept inside
// the pages there are, the buttons and the jump menu, pages of one kind only, the message a page draws, what `set` keeps of a
// message, what is read from the prefix text, the clean-up when messages are deleted, and a click on a shared and a private message.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, MessageFlags, PermissionsBitField } = require('discord.js');

// ---- A small database in memory with the calls the modules make (select / insert / update / delete, eq / in, order, single) ----
const tables = new Map();
let nextId = 1;
const rowsOf = (name) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name); };
function query(name) {
  const state = { action: 'select', filters: [], order: null, single: null, payload: null };
  const run = () => {
    const rows = rowsOf(name);
    const match = (row) => state.filters.every(([type, column, value]) => (type === 'eq' ? String(row[column]) === String(value) : value.map(String).includes(String(row[column]))));
    let data;
    if (state.action === 'insert') {
      const row = { id: String(nextId++), created_at: new Date(Date.now() + nextId).toISOString(), ...JSON.parse(JSON.stringify(state.payload)) };
      if (name === 'pagination_messages' && rows.some((each) => each.message_id === row.message_id)) return { data: null, error: { code: '23505' } };
      rows.push(row);
      data = [row];
    } else if (state.action === 'update') {
      data = rows.filter(match);
      for (const row of data) Object.assign(row, JSON.parse(JSON.stringify(state.payload)));
    } else if (state.action === 'delete') {
      data = rows.filter(match);
      tables.set(name, rows.filter((row) => !match(row)));
    } else {
      data = rows.filter(match);
      if (state.order) data = [...data].sort((a, b) => (a[state.order.column] < b[state.order.column] ? -1 : 1) * (state.order.ascending ? 1 : -1));
    }
    data = data.map((row) => ({ ...row }));
    if (state.single) {
      if (data.length > 1 || (state.single === 'single' && !data.length)) return { data: null, error: { message: 'not one row' } };
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  };
  const chain = {
    select() { return chain; },
    insert(values) { state.action = 'insert'; state.payload = values; return chain; },
    update(values) { state.action = 'update'; state.payload = values; return chain; },
    upsert(values) { state.action = 'insert'; state.payload = values; return chain; },
    delete() { state.action = 'delete'; return chain; },
    eq(column, value) { state.filters.push(['eq', column, value]); return chain; },
    in(column, value) { state.filters.push(['in', column, value]); return chain; },
    order(column, options = {}) { state.order = { column, ascending: options.ascending !== false }; return chain; },
    limit() { return chain; },
    single() { state.single = 'single'; return chain; },
    maybeSingle() { state.single = 'maybe'; return chain; },
    then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
  };
  return chain;
}
const resolvedDb = require.resolve(path.join(__dirname, '..', 'src', 'db', 'database'));
require.cache[resolvedDb] = { id: resolvedDb, filename: resolvedDb, loaded: true, exports: { from: query, rpc: async () => ({ data: null, error: null }) } };

const db = require('../src/db/paginations');
const P = require('../src/utils/pagination');
const command = require('../src/commands/config/pagination');
const { handlePaginationInteraction } = require('../src/interactions/pagination');
const deleteEvent = require('../src/events/messageDeletePagination');

const G = '100000000000000001';
const CH = '200000000000000002';
const MSG = '300000000000000003';
const BOT = '900000000000000009';
const USER = '400000000000000004';
const lang = 'en';
const getTemplate = async (guildId, name) => rowsOf('embed_templates').find((row) => row.guild_id === guildId && row.name === name) ?? null;
const json = (rows) => rows.map((row) => (typeof row.toJSON === 'function' ? row.toJSON() : row));
const toCode = (design) => `p2.${Buffer.from(JSON.stringify(design)).toString('base64url')}`;

(async () => {
  rowsOf('embed_templates').push(
    { guild_id: G, name: 'rules', data: { title: 'Rules', description: 'Be nice, {user.name}', fields: [] } },
    { guild_id: G, name: 'faq', data: { title: 'FAQ', description: 'Ask in #help', fields: [] } },
    { guild_id: G, name: 'card', data: { content: '', embeds: [], buttons: [], v2: { components: [{ type: 17, components: [{ type: 10, content: 'A V2 page' }] }] } } },
  );

  // ---- Records ----
  const made = await db.createPagination({ guildId: G, channelId: CH, messageId: MSG, kind: 'embed', pages: [{ type: 'embed', name: 'rules' }], createdBy: USER, postedByPetto: true });
  assert.equal(typeof made.id, 'string'); assert.equal(made.private, false); assert.equal(made.pages.length, 1);
  assert.equal((await db.getByMessage(G, MSG)).id, made.id, 'by message');
  assert.equal((await db.getPagination(made.id)).message_id, MSG, 'by id');
  assert.equal(await db.getPagination('not-a-number'), null, 'a bad id is no record and no query');
  assert.equal(await db.getByMessage('100000000000000099', MSG), null, 'never the record of another server');
  await assert.rejects(db.createPagination({ guildId: G, channelId: CH, messageId: MSG, kind: 'embed', pages: [] }), (err) => err.code === '23505', 'one record per message');
  const tooMany = Array.from({ length: 30 }, (_, n) => ({ type: 'code', code: `{embed}$v{title: ${n}}` }));
  const updated = await db.updatePagination(made, { pages: tooMany, isPrivate: true });
  assert.equal(updated.pages.length, db.MAX_PAGES, 'never more than 25 pages are kept'); assert.equal(updated.private, true);
  await db.updatePagination(updated, { pages: [{ type: 'embed', name: 'rules' }, { type: 'embed', name: 'faq' }], isPrivate: false });
  assert.equal(await db.countPaginations(G), 1);
  const other = await db.createPagination({ guildId: G, channelId: '200000000000000005', messageId: '300000000000000006', kind: 'v2', pages: [{ type: 'embed', name: 'card' }] });
  assert.deepEqual((await db.listPaginations(G)).map((row) => row.id), [made.id, other.id], 'listed oldest first');

  // A deleted message: only a known id costs a write; the cached list follows the changes made here.
  await deleteEvent.execute({ id: '399999999999999999', guildId: G });
  assert.equal(await db.countPaginations(G), 2, 'an unknown message changes nothing');
  await deleteEvent.execute({ id: '300000000000000006', guildId: G });
  assert.equal(await db.countPaginations(G), 1, 'the deleted paginated message lost its record');
  const third = await db.createPagination({ guildId: G, channelId: '200000000000000007', messageId: '300000000000000008', kind: 'embed', pages: [{ type: 'embed', name: 'faq' }] });
  assert.equal(await db.deleteByChannel(G, '200000000000000007'), 1, 'a deleted channel takes its messages');
  assert.equal(await db.getPagination(third.id), null);

  // ---- Button ids ----
  assert.deepEqual(P.parseCustomId('pgm::12::3::n'), { action: 'go', id: '12', page: 3, which: 'n' });
  assert.deepEqual(P.parseCustomId('pgm::12::jump'), { action: 'jump', id: '12' });
  assert.deepEqual(P.parseCustomId('pgm::12::label'), { action: 'label', id: '12' });
  assert.deepEqual(P.parseCustomId(`pgm::reset::${USER}::yes`), { action: 'reset', userId: USER, answer: 'yes' });
  for (const bad of ['pg::roles::1::2::x::y::next', 'pgm::abc::1::n', 'pgm::12::-1::p', 'pgm::12::9999::n', `pgm::reset::${USER}::maybe`, 'pgm::reset::me::yes', '', null]) {
    assert.equal(P.parseCustomId(bad), null, `not ours or broken: ${bad}`);
  }
  assert.ok(P.isPaginationId('pgm::1::0::f') && !P.isPaginationId('pg::roles::1') && !P.isPaginationId('pl_vote'));

  // ---- Page numbers ----
  assert.equal(P.clampPage(7, 3), 2, 'a page past the end is the last one (a page was removed since)');
  assert.equal(P.clampPage(-4, 3), 0); assert.equal(P.clampPage('x', 3), 0); assert.equal(P.clampPage(1.7, 3), 1); assert.equal(P.clampPage(3, 0), 0);
  assert.equal(P.pageIndex('2', 3), 1); assert.equal(P.pageIndex('0', 3), null); assert.equal(P.pageIndex('4', 3), null); assert.equal(P.pageIndex('1.5', 3), null); assert.equal(P.pageIndex('two', 3), null);

  // ---- Buttons and the jump menu ----
  assert.deepEqual(P.navRows('5', 0, 1, lang), [], 'one page has no buttons');
  const three = json(P.navRows('5', 1, 3, lang));
  assert.equal(three.length, 1); assert.equal(three[0].components.length, 3, 'previous, the label, next');
  assert.deepEqual(three[0].components.map((c) => c.custom_id), ['pgm::5::0::p', 'pgm::5::label', 'pgm::5::2::n']);
  assert.equal(three[0].components[1].label, 'Page 2/3'); assert.equal(three[0].components[1].disabled, true);
  const firstOfThree = json(P.navRows('5', 0, 3, lang))[0].components;
  assert.equal(firstOfThree[0].disabled, true, 'no previous on page 1'); assert.equal(firstOfThree[2].disabled, false);
  const lastOfThree = json(P.navRows('5', 9, 3, lang))[0].components;
  assert.equal(lastOfThree[1].label, 'Page 3/3', 'a page past the end shows the last'); assert.equal(lastOfThree[2].disabled, true);
  const many = json(P.navRows('5', 0, 25, lang, Array.from({ length: 25 }, (_, n) => ({ type: 'embed', name: `e${n}` }))));
  assert.equal(many.length, 2, 'the buttons and the jump menu');
  assert.deepEqual(many[0].components.map((c) => c.custom_id), ['pgm::5::0::f', 'pgm::5::0::p', 'pgm::5::label', 'pgm::5::1::n', 'pgm::5::24::l']);
  assert.equal(new Set(many[0].components.map((c) => c.custom_id)).size, 5, 'ids of their own even when two go to one page');
  assert.equal(many[1].components[0].custom_id, 'pgm::5::jump'); assert.equal(many[1].components[0].options.length, 25);
  assert.equal(many[1].components[0].options[0].default, true); assert.match(many[1].components[0].options[3].description, /e3/);
  assert.equal(json(P.navRows('5', 0, 5, lang)).length, 1, 'five pages: no menu yet');
  assert.ok(P.isNavRow(many[0]) && P.isNavRow(many[1]) && !P.isNavRow({ type: 1, components: [{ type: 2, style: 5, url: 'https://x.y' }] }));

  // ---- What a member types as a page ----
  const named = await P.sourceFromInput('rules', { guildId: G, lang, getTemplate });
  assert.deepEqual(named.source, { type: 'embed', name: 'rules' }); assert.equal(named.kind, 'embed');
  assert.equal((await P.sourceFromInput('missing', { guildId: G, lang, getTemplate })).error, 'noEmbed');
  assert.equal((await P.sourceFromInput('  ', { guildId: G, lang, getTemplate })).error, 'noSource');
  const code = await P.sourceFromInput('{embed}$v{title: Hello}$v{description: Page two}', { guildId: G, lang, getTemplate });
  assert.equal(code.source.type, 'code'); assert.equal(code.kind, 'embed'); assert.equal(code.data.title, 'Hello');
  const v2 = await P.sourceFromInput(toCode({ components: [{ type: 17, components: [{ type: 10, content: 'Hi' }] }] }), { guildId: G, lang, getTemplate });
  assert.equal(v2.kind, 'v2'); assert.equal((await P.sourceFromInput('p2.%%%', { guildId: G, lang, getTemplate })).error, 'badV2');
  assert.equal((await P.sourceFromInput('card', { guildId: G, lang, getTemplate })).kind, 'v2', 'a saved V2 design');

  // ---- One kind per message ----
  assert.equal(P.mixingProblem('embed', 'embed'), null); assert.equal(P.mixingProblem('v2', 'v2'), null); assert.equal(P.mixingProblem(null, 'v2'), null);
  assert.equal(P.mixingProblem('embed', 'v2'), 'mixV2'); assert.equal(P.mixingProblem('v2', 'embed'), 'mixEmbed');
  assert.match(require('../src/i18n').t('en', 'pagination.error.mixV2'), /cannot mix/);

  // ---- The message of a page ----
  const guild = { id: G, name: 'Test', members: { me: null, cache: new Collection() }, roles: { cache: new Collection() }, channels: { cache: new Collection() }, emojis: { cache: new Collection() }, iconURL: () => null, bannerURL: () => null, splashURL: () => null, discoverySplashURL: () => null };
  const member = { id: USER, displayName: 'Ana', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png', user: { id: USER, username: 'ana', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' }, roles: { cache: new Collection() }, permissions: new PermissionsBitField(PermissionsBitField.Flags.ManageMessages) };
  const ctx = { guild, channel: { id: CH, name: 'rules' }, member, user: member.user, lang };
  const record = { id: '42', kind: 'embed', pages: [{ type: 'embed', name: 'rules' }, { type: 'embed', name: 'faq' }, { type: 'code', code: '{embed}$v{title: Third}' }] };
  const page2 = await P.renderPage(record, 1, ctx, { getTemplate });
  assert.equal(page2.page, 1); assert.equal(page2.payload.embeds[0].toJSON().title, 'FAQ');
  assert.equal(json(page2.payload.components).at(-1).components[1].label, 'Page 2/3'); assert.deepEqual(page2.payload.attachments, [], 'old files are cleared');
  assert.equal((await P.renderPage(record, 99, ctx, { getTemplate })).page, 2, 'a stale button shows the last page');
  const mixedRecord = { id: '43', kind: 'embed', pages: [{ type: 'embed', name: 'rules' }, { type: 'embed', name: 'card' }] };
  assert.equal((await P.renderPage(mixedRecord, 1, ctx, { getTemplate })).error, 'pageIsV2', 'a saved embed that became V2 is refused');
  assert.equal((await P.renderPage({ id: '44', kind: 'embed', pages: [{ type: 'embed', name: 'gone' }] }, 0, ctx, { getTemplate })).error, 'embedGone');
  const v2Page = await P.renderPage({ id: '45', kind: 'v2', pages: [{ type: 'embed', name: 'card' }, { type: 'embed', name: 'card' }] }, 0, ctx, { getTemplate });
  assert.equal(v2Page.payload.flags, MessageFlags.IsComponentsV2); assert.ok(P.isNavRow(json(v2Page.payload.components).at(-1)), 'the buttons go last in a V2 page');
  assert.equal(await P.checkPage(named, ctx), null, 'a fine page passes');
  const fourRows = { kind: 'embed', data: { content: '', embeds: [{ title: 'x' }], buttons: Array.from({ length: 4 }, () => [{ label: 'a', url: 'https://petto.sbs' }]) } };
  assert.equal((await P.checkPage(fourRows, ctx)).error, 'tooManyRows', 'a page keeps room for the buttons');

  // ---- What `set` keeps of a message ----
  const navRow = P.navRows('9', 0, 3, lang)[0];
  const old = { flags: { bitfield: 0 }, content: 'Hello', embeds: [{ toJSON: () => ({ title: 'Old' }) }], components: [{ toJSON: () => navRow.toJSON() }, { toJSON: () => ({ type: 1, components: [{ type: 2, style: 5, label: 'Site', url: 'https://petto.sbs' }] }) }], attachments: { size: 0 } };
  const snap = P.snapshotMessage(old);
  assert.equal(snap.kind, 'embed'); assert.equal(snap.source.content, 'Hello'); assert.equal(snap.source.components.length, 1, 'the page buttons are not kept');
  assert.equal(P.snapshotMessage({ flags: { bitfield: 0 }, content: '', embeds: [], components: [], attachments: { size: 0 } }).error, 'emptyMessage');
  const v2Snap = P.snapshotMessage({ flags: { bitfield: MessageFlags.IsComponentsV2 }, components: [{ toJSON: () => ({ type: 17, components: [{ type: 10, content: 'x' }] }) }], attachments: { size: 1 } });
  assert.equal(v2Snap.kind, 'v2'); assert.equal(v2Snap.source.keepFiles, true);
  const kept = await P.renderPage({ id: '46', kind: 'v2', pages: [v2Snap.source, { type: 'embed', name: 'card' }] }, 1, ctx, { getTemplate });
  assert.equal(kept.payload.attachments, undefined, 'the files of the original message stay while one of its pages needs them');

  // ---- The prefix text ----
  const link = `https://discord.com/channels/${G}/${CH}/${MSG}`;
  assert.deepEqual(command.parseArgs('create', `<#${CH}> rules --private`), { private: true, channel: CH, embed: 'rules' });
  assert.deepEqual(command.parseArgs('create', '{embed}$v{title: Hi --there}'), { embed: '{embed}$v{title: Hi --there}' }, 'a code keeps a -- inside its braces');
  assert.deepEqual(command.parseArgs('set', `${link} --private`), { private: true, message: link });
  assert.deepEqual(command.parseArgs('add', `${link} {embed}$v{title: Two words}\n$v{description: line}`), { message: link, embed: '{embed}$v{title: Two words}\n$v{description: line}' });
  assert.deepEqual(command.parseArgs('add', 'faq'), { embed: 'faq' }, 'replying to the message: only the page');
  assert.deepEqual(command.parseArgs('update', `${link} 2 faq`), { message: link, page: '2', embed: 'faq' });
  assert.deepEqual(command.parseArgs('remove', `<#${CH}> ${MSG} 3`), { message: `${CH}/${MSG}`, page: '3' });
  assert.deepEqual(command.parseArgs('move', `${link} 3 1`), { message: link, from: '3', to: '1' });
  assert.deepEqual(command.parseArgs('mode', `${link} PRIVATE`), { message: link, mode: 'private' });
  assert.deepEqual(command.parseArgs('delete', `${link} --message`), { purge: true, message: link });
  assert.deepEqual(command.parseArgs('list', ''), {});
  assert.equal(command.prefixSubcommandAliases.restorereactions, 'restore'); assert.equal(command.prefixSubcommandAliases.rr, 'restore');
  assert.deepEqual(command.aliases, ['pn', 'pages']);
  assert.equal(command.registerSlash, undefined, 'prefix only');

  // ---- Clicks ----
  const live = await db.getByMessage(G, MSG); // rules, faq (shared)
  const answers = [];
  const click = (customId, { ephemeral = false, values } = {}) => ({
    customId, values, guildId: G, guild: { ...guild, members: { me: null, cache: new Collection([[USER, member]]), fetch: async () => member } }, channel: ctx.channel, member, user: member.user,
    message: { flags: new (require('discord.js').MessageFlagsBitField)(ephemeral ? MessageFlags.Ephemeral : 0) }, deferred: false, replied: false,
    isButton: () => true, isStringSelectMenu: () => false,
    update: async (payload) => answers.push(['update', payload]), reply: async (payload) => answers.push(['reply', payload]),
    deferUpdate: async () => answers.push(['deferUpdate']), deferReply: async () => answers.push(['deferReply']), editReply: async (payload) => answers.push(['editReply', payload]), followUp: async (payload) => answers.push(['followUp', payload]),
  });
  await handlePaginationInteraction(click(`pgm::${live.id}::1::n`));
  assert.equal(answers[0][0], 'update', 'a shared message turns for everyone');
  assert.equal(answers[0][1].embeds[0].toJSON().title, 'FAQ');
  await db.updatePagination(live, { isPrivate: true });
  await handlePaginationInteraction(click(`pgm::${live.id}::1::n`));
  assert.equal(answers[1][0], 'reply', 'a private message answers the member'); assert.ok(answers[1][1].flags & MessageFlags.Ephemeral);
  await handlePaginationInteraction(click(`pgm::${live.id}::0::p`, { ephemeral: true }));
  assert.equal(answers[2][0], 'update', 'the buttons of the private copy turn it in place');
  await handlePaginationInteraction(click(`pgm::${live.id}::jump`, { values: ['1'] }));
  assert.equal(answers[3][0], 'reply');
  await handlePaginationInteraction(click('pgm::987654::0::n'));
  assert.equal(answers[4][0], 'reply'); assert.match(answers[4][1].content, /no longer has pages/, 'a record that is gone');
  await handlePaginationInteraction(click(`pgm::reset::${BOT}::yes`));
  assert.match(answers[5][1].content, /Only/, 'only who asked confirms a reset');

  // ---- The dashboard routes: Manage Messages, the pages picked, delete ----
  const { registerPaginationRoutes } = require('../src/web/paginationRoutes');
  let handler;
  registerPaginationRoutes({ post: (_path, ...rest) => { handler = rest.at(-1); } }, { authorize: async (req) => req.access });
  const call = async (action, body, access) => {
    const out = {};
    const res = { status(code) { out.status = code; return res; }, json(value) { out.body = value; return res; } };
    await handler({ params: { action, guildId: G }, body, headers: {}, get: () => null, access }, res);
    return { status: out.status ?? 200, ...out.body };
  };
  const routeGuild = { id: G, client: { guilds: { cache: new Map() } }, channels: { cache: new Collection(), fetch: async () => null } };
  const manager = { permissions: new PermissionsBitField(PermissionsBitField.Flags.ManageMessages) };
  assert.equal((await call('nope', {}, { guild: routeGuild, member: manager })).status, 404);
  assert.equal((await call('create', {}, { guild: routeGuild, member: { permissions: new PermissionsBitField(0n) } })).code, 'no_permission', 'Manage Messages, like the command');
  assert.equal((await call('create', { channel_id: '1' }, { guild: routeGuild, member: manager })).code, 'bad_channel');
  assert.equal((await call('delete', { id: '987654' }, { guild: routeGuild, member: manager })).code, 'not_found');
  const routeRecord = await db.createPagination({ guildId: G, channelId: '200000000000000011', messageId: '300000000000000012', kind: 'embed', pages: [{ type: 'embed', name: 'faq' }] });
  const removed = await call('delete', { id: routeRecord.id }, { guild: routeGuild, member: manager });
  assert.equal(removed.ok, true); assert.equal(await db.getPagination(routeRecord.id), null, 'deleted from the dashboard');

  console.log('Checked paginated messages: records, button ids, page numbers, buttons and menu, one kind per message, pages, set, prefix text, clicks and dashboard routes.');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
