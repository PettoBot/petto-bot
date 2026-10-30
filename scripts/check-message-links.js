// Checks the message link embeds: how links are found in a text, who may see what (the member who posted the link and Petto must both be
// able to read the channel), what the embed shows, that nobody is pinged, the cooldown, and that a server with it off (the default) sees no
// change. Discord and the database are replaced with small fakes.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { ChannelType, MessageType, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// ---- the database: a table in memory that counts its reads ----------------------------------------------------------------------------
const table = new Map(); // guild_id -> row
let reads = 0;
stub('src/db/database.js', {
  from: () => {
    const query = { filter: {} };
    query.select = () => query;
    query.eq = (column, value) => { query.filter[column] = value; return query; };
    query.maybeSingle = async () => { reads += 1; return { data: table.get(query.filter.guild_id) ?? null, error: null }; };
    query.upsert = async (row) => { table.set(row.guild_id, { ...table.get(row.guild_id), ...row }); return { error: null }; };
    return query;
  },
});
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });

const links = require('../src/utils/messageLinks');
const db = require('../src/db/messageLinks');
const { handleInvalidationMessage } = require('../src/utils/cacheInvalidation');
const command = require('../src/commands/config/messagelinks');

const G = '100000000000000001';
const ID = (n) => `2000000000000000${String(n).padStart(2, '0')}`;
const url = (channel, message, guild = G, host = 'discord.com') => `https://${host}/channels/${guild}/${channel}/${message}`;

// ---- finding the links -----------------------------------------------------------------------------------------------------------------
const find = (text, max) => links.extractMessageLinks(text, max).map((l) => `${l.guildId}/${l.channelId}/${l.messageId}`);
const A = `${G}/${ID(1)}/${ID(2)}`;
for (const host of ['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com', 'canary.discordapp.com', 'ptb.discordapp.com']) {
  assert.deepEqual(find(`look ${url(ID(1), ID(2), G, host)} please`), [A], `${host} is read`);
}
assert.deepEqual(find(`HTTPS://DISCORD.COM/channels/${A}`), [], 'the cheap first look wants the usual lower case');
assert.deepEqual(find(`http://discord.com/channels/${A}`), [A], 'http too');
for (const trailing of ['.', ',', ')', '!', '?', ']', '*', '"', ';', ':', '>']) assert.deepEqual(find(`see ${url(ID(1), ID(2))}${trailing}`), [A], `a trailing ${JSON.stringify(trailing)} is not part of the link`);
assert.deepEqual(find(`[that message](${url(ID(1), ID(2))})`), [A], 'a markdown link');
assert.deepEqual(find(`(${url(ID(1), ID(2))})`), [A], 'in parentheses');
assert.deepEqual(find(`**${url(ID(1), ID(2))}**`), [A], 'in bold');
assert.deepEqual(find(`<${url(ID(1), ID(2))}>`), [], '<link> is the way to ask for no preview');
assert.deepEqual(find(`<${url(ID(1), ID(2))}> and ${url(ID(1), ID(3))}`), [`${G}/${ID(1)}/${ID(3)}`], 'only the one in angle brackets is left out');
assert.deepEqual(find('```\n' + url(ID(1), ID(2)) + '\n```'), [], 'a code block');
assert.deepEqual(find('`' + url(ID(1), ID(2)) + '`'), [], 'inline code');
assert.deepEqual(find('``' + url(ID(1), ID(2)) + '`` and ' + url(ID(1), ID(3))), [`${G}/${ID(1)}/${ID(3)}`], 'inline code with two backticks');
assert.deepEqual(find(`||${url(ID(1), ID(2))}||`), [], 'a spoiler stays hidden');
assert.deepEqual(find('```js\ncode ' + url(ID(1), ID(2)) + ' ```\nafter ' + url(ID(1), ID(3))), [`${G}/${ID(1)}/${ID(3)}`], 'a link after a code block is found');
assert.deepEqual(find(`${url(ID(1), ID(2))} ${url(ID(1), ID(2))}`), [A], 'the same link twice is one');
assert.deepEqual(find(`${url(ID(1), ID(2))} ${url(ID(1), ID(3))} ${url(ID(1), ID(4))} ${url(ID(1), ID(5))} ${url(ID(1), ID(6))}`).length, 3, 'at most 3 links');
assert.deepEqual(find(`${url(ID(1), ID(2))} ${url(ID(1), ID(3))}`, 1).length, 1);
assert.deepEqual(find('https://discord.com/channels/@me/123/456'), [], 'a direct message link is not one');
assert.deepEqual(find(`https://discord.com/channels/${G}/${ID(1)}`), [], 'a channel link is not a message link');
assert.deepEqual(find('https://discord.com/channels/12/34/56'), [], 'ids that cannot be real');
assert.deepEqual(find(`https://example.com/channels/${A}`), [], 'another site');
assert.deepEqual(find(`https://discord.com.evil.io/channels/${A}`), [], 'a host that only starts like Discord');
assert.deepEqual(find('hello there'), []);
assert.deepEqual(find(null), []);
assert.equal(links.mayHaveLink('nothing'), false);
assert.equal(links.mayHaveLink(url(ID(1), ID(2))), true);
assert.equal(links.extractMessageLinks(url(ID(1), ID(2)))[0].url, `https://discord.com/channels/${A}`, 'the link is written the usual way');
assert.equal(links.extractMessageLinks(url(ID(1), ID(2), G, 'ptb.discordapp.com'))[0].url, `https://discord.com/channels/${A}`);

// ---- the fakes ---------------------------------------------------------------------------------------------------------------------------
const ALL = P.ViewChannel | P.ReadMessageHistory | P.SendMessages | P.EmbedLinks | P.SendMessagesInThreads;
const bits = (...flags) => flags.reduce((total, flag) => total | flag, 0n);
const BOT = 'bot-user';
const ME = { id: BOT };
const ANA = { id: 'ana' };

function makeChannel(id, { name = `chan-${id.slice(-2)}`, nsfw = false, type = ChannelType.GuildText, allow = {}, parent = null, members = null, messages = [] } = {}) {
  const store = new Map(messages.map((m) => [m.id, m]));
  const channel = {
    id, name, nsfw, type, guildId: G, parentId: parent?.id ?? null, parent,
    permissionsFor: (member) => new PermissionsBitField(allow[member.id] ?? 0n),
    isThread: () => type === ChannelType.PublicThread || type === ChannelType.PrivateThread,
    isTextBased: () => true, isDMBased: () => false,
    messages: {
      cache: new Map(),
      fetchCalls: [],
      fetch: async (options) => { channel.messages.fetchCalls.push(options); const found = store.get(options.message); if (!found) throw new Error('Unknown Message'); return found; },
    },
    members: { fetch: async ({ member }) => { if (members?.includes(member)) return { id: member }; throw new Error('Unknown Member'); } },
  };
  return channel;
}
const target = (id, extra = {}) => ({
  id, type: MessageType.Default, system: false, partial: false, flags: { has: () => false },
  content: 'hello world', createdTimestamp: 1_700_000_000_000, attachments: new Map(), embeds: [], stickers: new Map(),
  author: { id: 'bob', username: 'bob', globalName: 'Bob', displayAvatarURL: () => 'https://cdn.example/bob.png' },
  member: { displayName: 'Bobby', displayAvatarURL: () => 'https://cdn.example/bobby.png' }, ...extra,
});
const att = (name, extra = {}) => ({ name, url: `https://cdn.example/${name}`, contentType: /\.(png|jpe?g|gif)$/i.test(name) ? 'image/png' : 'application/octet-stream', ...extra });

function world({ channels, guildId = G } = {}) {
  const map = new Map(channels.map((c) => [c.id, c]));
  const cache = { get: (id) => map.get(id) };
  const guild = { id: guildId, channels: { cache, fetch: async (id) => map.get(id) ?? null }, members: { me: ME, fetch: async () => ANA } };
  return guild;
}
let nextMessage = 5000;
function post(guild, source, content, extra = {}) {
  const replies = [];
  const message = {
    id: ID(nextMessage++), guild, channel: source, content, author: { id: 'ana', bot: false }, member: ANA, type: MessageType.Default, system: false,
    client: { user: ME }, replies, deleted: false,
    reply: async (payload) => { replies.push(payload); return {}; },
    delete: async () => { message.deleted = true; },
    ...extra,
  };
  return message;
}
const silentLogger = { warns: [], warn(text) { this.warns.push(text); } };
const clock = { t: 1_000_000 };
const newLimiter = () => links.createLimiter({ now: () => clock.t });
const ON = { ignored_channels: [] };
async function run(message, { settings = ON, limiter = newLimiter(), lang = 'en' } = {}) {
  let asked = 0;
  const result = await links.expandMessageLinks(message, { getSettings: async () => { asked += 1; return settings; }, limiter, lang, logger: silentLogger });
  return { ...result, asked };
}

(async () => {
  // ---- who may see what ------------------------------------------------------------------------------------------------------------------
  const readable = { ana: ALL, [BOT]: ALL };
  const msg = target(ID(2));
  const open = makeChannel(ID(1), { allow: readable, messages: [msg] });
  const source = makeChannel(ID(9), { allow: readable });
  let guild = world({ channels: [open, source] });
  let result = await run(post(guild, source, `see ${url(open.id, msg.id)}`));
  assert.equal(result.status, 'sent', 'the usual case');
  assert.equal(result.count, 1);

  const refused = async (name, channels, content, options) => {
    const g = world({ channels });
    const main = channels.find((c) => c.id === ID(9)) ?? source;
    const m = post(g, main, content(g));
    const out = await run(m, options);
    assert.equal(out.status, 'skipped', `${name}: nothing is shown`);
    assert.equal(m.replies.length, 0, `${name}: nothing is sent`);
    return out;
  };
  await refused('the member cannot see the channel', [makeChannel(ID(1), { allow: { [BOT]: ALL }, messages: [msg] }), source], () => url(ID(1), ID(2)));
  await refused('the member cannot read the history', [makeChannel(ID(1), { allow: { ana: bits(P.ViewChannel), [BOT]: ALL }, messages: [msg] }), source], () => url(ID(1), ID(2)));
  await refused('the member has no View Channel', [makeChannel(ID(1), { allow: { ana: bits(P.ReadMessageHistory), [BOT]: ALL }, messages: [msg] }), source], () => url(ID(1), ID(2)));
  await refused('the bot cannot see the channel', [makeChannel(ID(1), { allow: { ana: ALL }, messages: [msg] }), source], () => url(ID(1), ID(2)));
  await refused('another server', [open, source], () => url(ID(1), ID(2), '999999999999999999'));
  await refused('an unknown channel', [source], () => url(ID(1), ID(2)));
  await refused('a message that is gone', [makeChannel(ID(1), { allow: readable, messages: [] }), source], () => url(ID(1), ID(77)));
  {
    const g = world({ channels: [open, source] });
    const m = post(g, source, 'x');
    m.content = url(open.id, m.id);
    open.messages.cache.set(m.id, target(m.id));
    const out = await run(m);
    assert.equal(out.status, 'skipped', 'a link to the message that contains it');
    open.messages.cache.clear();
  }

  // NSFW: never opened in a channel that is not NSFW; fine in one that is.
  const nsfw = makeChannel(ID(3), { nsfw: true, allow: readable, messages: [target(ID(4))] });
  await refused('an NSFW channel from a channel that is not NSFW', [nsfw, source], () => url(ID(3), ID(4)));
  const nsfwSource = makeChannel(ID(9), { nsfw: true, allow: readable });
  guild = world({ channels: [nsfw, nsfwSource] });
  assert.equal((await run(post(guild, nsfwSource, url(ID(3), ID(4))))).status, 'sent', 'an NSFW channel from an NSFW one');
  guild = world({ channels: [open, nsfwSource] });
  assert.equal((await run(post(guild, nsfwSource, url(open.id, msg.id)))).status, 'sent', 'a normal channel from an NSFW one');
  const nsfwParent = makeChannel(ID(30), { nsfw: true, allow: readable });
  const nsfwThread = makeChannel(ID(31), { type: ChannelType.PublicThread, parent: nsfwParent, allow: readable, messages: [target(ID(32))] });
  await refused('a thread of an NSFW channel from a channel that is not NSFW', [nsfwThread, source], () => url(ID(31), ID(32)));

  // Threads: the permissions of the parent, and a private thread only for those inside it.
  const parent = makeChannel(ID(40), { allow: readable });
  const publicThread = makeChannel(ID(41), { type: ChannelType.PublicThread, parent, allow: readable, messages: [target(ID(42))] });
  guild = world({ channels: [publicThread, source] });
  assert.equal((await run(post(guild, source, url(ID(41), ID(42))))).status, 'sent', 'a public thread');
  const hiddenParent = makeChannel(ID(43), { allow: { [BOT]: ALL } });
  await refused('a thread whose parent the member cannot see', [makeChannel(ID(44), { type: ChannelType.PublicThread, parent: hiddenParent, allow: { [BOT]: ALL }, messages: [target(ID(45))] }), source], () => url(ID(44), ID(45)));
  const privateIn = makeChannel(ID(46), { type: ChannelType.PrivateThread, parent, allow: readable, members: ['ana', BOT], messages: [target(ID(47))] });
  guild = world({ channels: [privateIn, source] });
  assert.equal((await run(post(guild, source, url(ID(46), ID(47))))).status, 'sent', 'a private thread the member and Petto are in');
  await refused('a private thread the member is not in', [makeChannel(ID(48), { type: ChannelType.PrivateThread, parent, allow: readable, members: [BOT], messages: [target(ID(49))] }), source], () => url(ID(48), ID(49)));
  await refused('a private thread Petto is not in', [makeChannel(ID(50), { type: ChannelType.PrivateThread, parent, allow: readable, members: ['ana'], messages: [target(ID(51))] }), source], () => url(ID(50), ID(51)));
  guild = world({ channels: [makeChannel(ID(52), { type: ChannelType.PrivateThread, parent, allow: { ana: ALL | P.ManageThreads, [BOT]: ALL | P.ManageThreads }, members: [], messages: [target(ID(53))] }), source] });
  assert.equal((await run(post(guild, source, url(ID(52), ID(53))))).status, 'sent', 'a moderator who manages threads');
  // A thread as the place where the link is posted needs the permission for threads.
  const threadSource = makeChannel(ID(54), { type: ChannelType.PublicThread, parent, allow: { ana: ALL, [BOT]: bits(P.ViewChannel, P.ReadMessageHistory, P.EmbedLinks) } });
  guild = world({ channels: [open, threadSource] });
  assert.equal((await run(post(guild, threadSource, url(open.id, msg.id)))).status, 'skipped', 'Petto cannot send in the thread');

  // The messages that are left alone.
  const odd = [
    ['an ephemeral message', target(ID(60), { flags: { has: () => true } })],
    ['a system message', target(ID(61), { system: true })],
    ['a message type that is not a normal one', target(ID(62), { type: MessageType.UserJoin })],
    ['a partial message', target(ID(63), { partial: true })],
  ];
  for (const [name, odd1] of odd) {
    const c = makeChannel(ID(1), { allow: readable, messages: [odd1] });
    await refused(name, [c, source], () => url(ID(1), odd1.id));
  }
  const ignoreCases = [
    ['a bot that posts the link', { author: { id: 'robot', bot: true } }],
    ['a webhook', { webhookId: '1' }],
    ['a system message that holds the link', { system: true }],
    ['a message of a type that is not normal', { type: MessageType.ChannelPinnedMessage }],
  ];
  for (const [name, extra] of ignoreCases) {
    const g = world({ channels: [open, source] });
    const m = post(g, source, url(open.id, msg.id), extra);
    assert.equal((await run(m)).status, 'skipped', name);
    assert.equal(m.replies.length, 0);
  }
  {
    const g = world({ channels: [open, source] });
    const m = post(g, source, url(open.id, msg.id), { type: MessageType.Reply });
    assert.equal((await run(m)).status, 'sent', 'a reply that holds a link');
  }
  {
    const g = world({ channels: [open, source] });
    const m = post(g, source, 'no link here');
    const out = await run(m);
    assert.equal(out.status, 'skipped');
    assert.equal(out.asked, 0, 'a message with no link never asks the settings');
  }

  // The poster is fetched when the member is not in the cache; if that fails nothing is shown.
  {
    const g = world({ channels: [open, source] });
    const m = post(g, source, url(open.id, msg.id), { member: null });
    assert.equal((await run(m)).status, 'sent', 'the member is fetched');
    g.members.fetch = async () => { throw new Error('Unknown Member'); };
    const m2 = post(g, source, url(open.id, msg.id), { member: null });
    assert.equal((await run(m2)).status, 'skipped', 'a member that cannot be found');
  }

  // ---- off, ignored, Embed Links ---------------------------------------------------------------------------------------------------------
  {
    const g = world({ channels: [open, source] });
    const m = post(g, source, url(open.id, msg.id));
    const out = await run(m, { settings: false });
    assert.deepEqual([out.status, out.reason, m.replies.length], ['skipped', 'off', 0], 'off: nothing');
  }
  {
    const before = open.messages.fetchCalls.length;
    const g = world({ channels: [open, source] });
    await run(post(g, source, url(open.id, msg.id)), { settings: false });
    assert.equal(open.messages.fetchCalls.length, before, 'off: the linked message is not even read');
    assert.equal((await run(post(g, source, url(open.id, msg.id)), { settings: { ignored_channels: [open.id] } })).status, 'skipped', 'a linked channel that is ignored');
    assert.equal((await run(post(g, source, url(open.id, msg.id)), { settings: { ignored_channels: [source.id] } })).status, 'skipped', 'links posted in an ignored channel');
    assert.equal((await run(post(g, threadSource, url(open.id, msg.id)), { settings: { ignored_channels: [parent.id] } })).status, 'skipped', 'a thread of an ignored channel');
    assert.equal((await run(post(g, source, url(open.id, msg.id)), { settings: { ignored_channels: ['555'] } })).status, 'sent', 'another channel ignored');
  }
  {
    const noEmbed = makeChannel(ID(9), { allow: { ana: ALL, [BOT]: ALL & ~P.EmbedLinks } });
    const g = world({ channels: [open, noEmbed] });
    silentLogger.warns.length = 0;
    const m = post(g, noEmbed, url(open.id, msg.id));
    assert.equal((await run(m)).status, 'skipped', 'without Embed Links nothing is shown');
    await run(post(g, noEmbed, url(open.id, msg.id)));
    await run(post(g, noEmbed, url(open.id, msg.id)));
    assert.equal(silentLogger.warns.length, 1, 'and it is said once in the log');
    assert.match(silentLogger.warns[0], /Embed Links/);
    const cannotSend = makeChannel(ID(9), { allow: { ana: ALL, [BOT]: bits(P.ViewChannel) } });
    assert.equal((await run(post(world({ channels: [open, cannotSend] }), cannotSend, url(open.id, msg.id)))).status, 'skipped', 'a channel Petto cannot write in');
  }

  // ---- the embed -------------------------------------------------------------------------------------------------------------------------
  const embedOf = async (message, options = {}) => {
    const c = makeChannel(ID(1), { allow: readable, messages: [message] });
    const g = world({ channels: [c, source] });
    const m = post(g, source, url(c.id, message.id));
    const out = await run(m, options);
    assert.equal(out.status, 'sent');
    return { reply: m.replies[0], json: m.replies[0].embeds[0].toJSON(), message: m };
  };
  {
    const { reply, json, message } = await embedOf(target(ID(2), { content: 'Hello **world**' }));
    assert.equal(json.description, 'Hello **world**');
    assert.equal(json.author.name, 'Bobby', 'the name of the member');
    assert.equal(json.author.icon_url, 'https://cdn.example/bobby.png', 'and the avatar');
    assert.equal(json.footer.text, '#chan-01', 'the channel in the footer');
    assert.equal(json.timestamp, new Date(1_700_000_000_000).toISOString(), 'and the time');
    assert.equal(json.image, undefined);
    const button = reply.components[0].toJSON().components[0];
    assert.equal(button.style, 5, 'a link button');
    assert.equal(button.label, 'Jump to message');
    assert.equal(button.url, url(ID(1), ID(2)));
    assert.deepEqual(reply.allowedMentions, { parse: [], repliedUser: false }, 'nobody is notified');
    assert.equal(reply.failIfNotExists, false);
    assert.equal(message.deleted, false, 'the message of the member is never deleted');
  }
  {
    const long = 'x'.repeat(9000);
    const { json } = await embedOf(target(ID(2), { content: long }));
    assert.ok(json.description.length <= 4096, 'the text is clipped to the limit of an embed');
    assert.ok(json.description.endsWith('…'));
  }
  {
    const { json } = await embedOf(target(ID(2), { content: 'pic', attachments: new Map([['1', att('cat.png')], ['2', att('notes.pdf')], ['3', att('dog.jpg')], ['4', att('SPOILER_secret.png')]]) }));
    assert.equal(json.image.url, 'https://cdn.example/cat.png', 'the first picture is the image');
    const files = json.fields.find((f) => f.name === 'Attachments').value;
    assert.match(files, /\[notes\.pdf\]\(https:\/\/cdn\.example\/notes\.pdf\)/, 'the others are listed by name with a link');
    assert.match(files, /\[dog\.jpg\]/);
    assert.match(files, /\[SPOILER_secret\.png\]/, 'a spoiler picture is only a link');
    assert.doesNotMatch(files, /cat\.png/);
  }
  {
    const { json } = await embedOf(target(ID(2), { content: '', attachments: new Map([['1', att('a.pdf')]]) }));
    assert.equal(json.description, undefined, 'no text and a file: no filler text');
    assert.ok(json.fields.length === 1);
    const empty = await embedOf(target(ID(2), { content: '' }));
    assert.equal(empty.json.description, '*No text content*', 'nothing at all: a note');
  }
  {
    const { json } = await embedOf(target(ID(2), { content: 'with embeds', embeds: [{ image: { url: 'https://cdn.example/e1.png' } }, { thumbnail: { url: 'https://cdn.example/e2.png' } }, { image: { url: 'http://insecure.example/e3.png' } }] }));
    assert.equal(json.image.url, 'https://cdn.example/e1.png', 'the picture of an embed of the message');
    assert.match(json.fields[0].value, /e2\.png/, 'the other pictures are listed');
    assert.doesNotMatch(json.fields[0].value, /insecure/, 'an address that is not https is left out');
    const both = await embedOf(target(ID(2), { attachments: new Map([['1', att('cat.png')]]), embeds: [{ image: { url: 'https://cdn.example/e1.png' } }] }));
    assert.equal(both.json.image.url, 'https://cdn.example/cat.png', 'an attached picture comes first');
    assert.match(both.json.fields[0].value, /e1\.png/);
    const botMessage = await embedOf(target(ID(2), { content: '', embeds: [{ title: 'Title', description: 'Body of the embed' }] }));
    assert.equal(botMessage.json.description, '**Title**\nBody of the embed', 'the text of the embed of a bot message');
  }
  {
    const { json } = await embedOf(target(ID(2), { content: 'sticker time', stickers: new Map([['1', { name: 'Wave' }]]) }));
    assert.match(json.description, /Sticker: \*\*Wave\*\*/, 'a note for the stickers');
    assert.ok(json.description.startsWith('sticker time'));
  }
  {
    const reply = target(ID(2), { content: 'agreed', type: MessageType.Reply, reference: { messageId: ID(70), channelId: ID(1), guildId: G }, mentions: { repliedUser: { username: 'carl', globalName: 'Carl' } } });
    const { json } = await embedOf(reply);
    assert.match(json.description, /^-# ↩ \[Replying to Carl\]\(https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+\)\nagreed$/, 'who it replies to, with a link');
    const unknown = await embedOf(target(ID(2), { content: 'ok', type: MessageType.Reply, reference: { messageId: ID(70), channelId: ID(1), guildId: G } }));
    assert.match(unknown.json.description, /Replying to a message/);
    const longReply = await embedOf(target(ID(2), { content: 'y'.repeat(9000), type: MessageType.Reply, reference: { messageId: ID(70), channelId: ID(1) }, mentions: { repliedUser: { username: 'carl' } }, stickers: new Map([['1', { name: 'W' }]]) }));
    assert.ok(longReply.json.description.length <= 4096, 'the reply line and the sticker note count in the limit');
  }
  {
    const { json } = await embedOf(target(ID(2), { content: 'hi', member: null }));
    assert.equal(json.author.name, 'Bob', 'a member who left: the global name');
    assert.equal(json.author.icon_url, 'https://cdn.example/bob.png');
  }
  {
    const injection = target(ID(2), { content: '@everyone <@&123> <@456> hi' });
    const { reply, json } = await embedOf(injection);
    assert.match(json.description, /@everyone/, 'the text is shown as it is');
    assert.equal(reply.content, undefined, 'and only inside the embed');
    assert.deepEqual(reply.allowedMentions.parse, [], 'where it pings nobody');
    assert.equal(reply.allowedMentions.users, undefined);
    assert.equal(reply.allowedMentions.roles, undefined);
  }
  {
    const es = await embedOf(target(ID(2), { content: '', stickers: new Map([['1', { name: 'Hola' }]]) }), { lang: 'es' });
    assert.match(es.json.description, /Sticker: \*\*Hola\*\*/);
    assert.equal(es.reply.components[0].toJSON().components[0].label, 'Ir al mensaje');
    const pt = await embedOf(target(ID(2), { content: 'oi' }), { lang: 'pt-BR' });
    assert.equal(pt.reply.components[0].toJSON().components[0].label, 'Ir para a mensagem');
  }

  // Several links: one answer with up to 3 embeds and a button for each.
  {
    const c = makeChannel(ID(1), { allow: readable, messages: [target(ID(2), { content: 'one' }), target(ID(3), { content: 'two' }), target(ID(4), { content: 'three' }), target(ID(5), { content: 'four' })] });
    const g = world({ channels: [c, source] });
    const m = post(g, source, [2, 3, 4, 5].map((n) => url(c.id, ID(n))).join(' '));
    assert.equal((await run(m)).status, 'sent');
    assert.equal(m.replies.length, 1, 'one reply');
    assert.deepEqual(m.replies[0].embeds.map((e) => e.toJSON().description), ['one', 'two', 'three'], 'only the first three links');
    assert.deepEqual(m.replies[0].components[0].toJSON().components.map((b) => b.label), ['Jump to message 1', 'Jump to message 2', 'Jump to message 3']);
    // One link another server's, one the member cannot see, one fine: only the fine one.
    const hidden = makeChannel(ID(7), { allow: { [BOT]: ALL }, messages: [target(ID(8))] });
    const g2 = world({ channels: [c, hidden, source] });
    const m2 = post(g2, source, `${url(ID(7), ID(8))} ${url(c.id, ID(2), '999999999999999999')} ${url(c.id, ID(3))}`);
    assert.equal((await run(m2)).status, 'sent');
    assert.deepEqual(m2.replies[0].embeds.map((e) => e.toJSON().description), ['two']);
  }

  // The linked message is read from the cache of the channel first, otherwise once, and the fetch is not kept.
  {
    const cached = target(ID(2), { content: 'from the cache' });
    const c = makeChannel(ID(1), { allow: readable, messages: [] });
    c.messages.cache.set(cached.id, cached);
    const g = world({ channels: [c, source] });
    const m = post(g, source, url(c.id, cached.id));
    assert.equal((await run(m)).status, 'sent');
    assert.equal(c.messages.fetchCalls.length, 0, 'the cache of the channel first');
    const c2 = makeChannel(ID(1), { allow: readable, messages: [target(ID(2))] });
    await run(post(world({ channels: [c2, source] }), source, url(c2.id, ID(2))));
    assert.deepEqual(c2.messages.fetchCalls, [{ message: ID(2), cache: false }], 'one fetch of one message, not kept');
  }

  // ---- the cooldown ----------------------------------------------------------------------------------------------------------------------
  {
    const limiter = newLimiter();
    const g = world({ channels: [open, source] });
    const first = post(g, source, url(open.id, msg.id));
    assert.equal((await run(first, { limiter })).status, 'sent');
    const second = post(g, source, url(open.id, msg.id));
    assert.equal((await run(second, { limiter })).reason, 'cooldown', 'the same channel within 3 seconds');
    assert.equal(second.replies.length, 0);
    const other = makeChannel(ID(19), { allow: readable });
    const g2 = world({ channels: [open, source, other] });
    assert.equal((await run(post(g2, other, url(open.id, msg.id)), { limiter })).status, 'sent', 'another channel has its own');
    clock.t += 2900;
    assert.equal((await run(post(g, source, url(open.id, msg.id)), { limiter })).reason, 'cooldown', 'still running at 2.9 seconds');
    clock.t += 200;
    assert.equal((await run(post(g, source, url(open.id, msg.id)), { limiter })).status, 'sent', 'and over after 3');
    assert.equal(links.CHANNEL_COOLDOWN_MS, 3000);
    // A message that shows nothing does not start the cooldown.
    const quiet = newLimiter();
    const hidden = makeChannel(ID(7), { allow: { [BOT]: ALL }, messages: [target(ID(8))] });
    const g3 = world({ channels: [open, hidden, source] });
    await run(post(g3, source, url(ID(7), ID(8))), { limiter: quiet });
    assert.equal(quiet.size(), 0, 'a refusal leaves no mark');
    assert.equal((await run(post(g3, source, url(open.id, msg.id)), { limiter: quiet })).status, 'sent');
    // Many links in a second are not a way to flood: only the first message gets an answer.
    const flood = newLimiter();
    let sent = 0;
    for (let i = 0; i < 20; i += 1) if ((await run(post(g, source, url(open.id, msg.id)), { limiter: flood })).status === 'sent') sent += 1;
    assert.equal(sent, 1, 'a flood of links gets one answer per 3 seconds');
    assert.equal(Object.keys(links).includes('GUILD_HOURLY_CAP'), false, 'there is no cap per server: only 3 links a message and the cooldown');
  }

  // ---- the setting: off by default, kept in memory, changed by the command ---------------------------------------------------------------
  {
    table.clear();
    reads = 0;
    const guildId = '300000000000000001';
    assert.equal(await db.getSettings(guildId), false, 'a server that never set it: off');
    for (let i = 0; i < 50; i += 1) await db.getSettings(guildId);
    assert.equal(reads, 1, 'asked once, then from memory (also the negative answer)');
    const run1 = await Promise.all(Array.from({ length: 10 }, () => db.getSettings('300000000000000002')));
    assert.deepEqual(run1, new Array(10).fill(false));
    assert.equal(reads, 2, 'messages that arrive together share one query');

    // The command.
    const sent = [];
    const interactionFor = (sub, channelId = null) => ({
      guild: { id: guildId, members: { me: ME } }, channel: { id: 'c', permissionsFor: () => new PermissionsBitField(ALL) }, typedPrefix: '!',
      options: { getSubcommand: () => sub, getChannel: () => ({ id: channelId }) },
      reply: async (payload) => { sent.push(JSON.stringify(payload.components.map((c) => c.toJSON()))); },
    });
    await command.execute(interactionFor('status'));
    assert.match(sent.pop(), /Message link embeds · off/, 'status says off');
    await command.execute(interactionFor('on'));
    assert.match(sent.pop(), /are \*\*on\*\*/);
    assert.equal(table.get(guildId).enabled, true);
    assert.deepEqual(await db.getSettings(guildId), { ignored_channels: [] }, 'on is seen at once');
    await command.execute(interactionFor('ignore', '400000000000000001'));
    assert.match(sent.pop(), /<#400000000000000001>/);
    await command.execute(interactionFor('ignore', '400000000000000001'));
    assert.match(sent.pop(), /already ignored/);
    assert.deepEqual((await db.getSettings(guildId)).ignored_channels, ['400000000000000001']);
    await command.execute(interactionFor('status'));
    const card = sent.pop();
    assert.match(card, /Message link embeds · on/);
    assert.match(card, /Ignored channels: <#400000000000000001>/);
    assert.match(card, /!messagelinks on/);
    assert.match(card, /already see/, 'the privacy rule is in the card');
    await command.execute(interactionFor('unignore', '400000000000000001'));
    assert.match(sent.pop(), /not ignored any more/);
    await command.execute(interactionFor('unignore', '400000000000000001'));
    assert.match(sent.pop(), /was not ignored/);
    await command.execute(interactionFor('off'));
    assert.match(sent.pop(), /are \*\*off\*\*/);
    assert.equal(await db.getSettings(guildId), false, 'off is seen at once');
    // The dashboard writes the table itself: petto:invalidate makes the bot forget.
    table.set(guildId, { guild_id: guildId, enabled: true, ignored_channels: [] });
    assert.equal(await db.getSettings(guildId), false, 'still the old answer in memory');
    handleInvalidationMessage(JSON.stringify({ table: 'message_link_settings', guildId }));
    assert.deepEqual(await db.getSettings(guildId), { ignored_channels: [] }, 'the dashboard change arrives');
    // Without Embed Links in the channel where it is turned on, it says so.
    const lacking = interactionFor('on');
    lacking.channel.permissionsFor = () => new PermissionsBitField(bits(P.ViewChannel));
    await command.execute(lacking);
    assert.match(sent.pop(), /Embed Links/);
  }

  // The command itself: who can use it, the words and the slash command.
  {
    const json = command.data.toJSON();
    assert.equal(BigInt(json.default_member_permissions), P.ManageGuild, 'Manage Server');
    assert.deepEqual(json.options.map((o) => o.name), ['on', 'off', 'status', 'ignore', 'unignore']);
    assert.deepEqual(command.aliases, ['msglinks', 'linkembed', 'mlinks']);
    assert.equal(command.registerSlash, true, 'it is a slash command too');
    assert.equal(json.dm_permission, false);
  }

  console.log('check-message-links: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
