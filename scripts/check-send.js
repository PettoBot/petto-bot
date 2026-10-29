// Checks `!send` (who may send what, mentions, files, embed codes with buttons) and the embed code of `!welcome setup`,
// against a fake server.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { verifyBaseUrl: null });
stub('src/db/guilds.js', { ensureGuild: async () => ({ prefix: '!' }) });
stub('src/db/embedTemplates.js', { getTemplate: async (guildId, name) => (name === 'rules' ? { data: { content: 'rules' } } : null) });
stub('src/db/database.js', { from: () => { throw new Error('no database'); } });
stub('src/db/memberEvents.js', { getConfig: async () => null, upsertConfig: async () => {} });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', ALERT: '!' } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/utils/embedVariables.js', { resolve: async (text) => text.replaceAll('{user.mention}', '@Liam') });
stub('src/utils/cardService.js', { normalizeCardRef: () => null, renderCardForMessage: async () => null, CARD_FILE_NAME: 'card.png', plainMessage: async (text) => ({ content: text.replaceAll('{user.mention}', '@Liam') }) });
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const send = require('../src/commands/config/send');
const welcome = require('../src/commands/welcome/welcome');

const ROLE = '111111111111111111';
const HIGH = '333333333333333333';
const CHANNEL = '444444444444444444';

function world({ permissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages], manageRoles = false, attachments = [] } = {}) {
  const sent = [];
  const replies = [];
  const roles = new Collection([
    [ROLE, { id: ROLE, name: 'Members', position: 1, mentionable: true }],
    [HIGH, { id: HIGH, name: 'Boss', position: 10, mentionable: false }],
  ]);
  roles.find = (fn) => [...roles.values()].find(fn);
  const bits = new PermissionsBitField(permissions);
  const channel = {
    id: CHANNEL, guildId: '1', isTextBased: () => true,
    permissionsFor: () => bits,
    // The answer of the command is a Components V2 card sent to the same channel; what the command sends is not.
    send: async (payload) => { (payload.flags ? replies : sent).push(payload); return { url: 'https://discord.com/channels/1/4/5' }; },
  };
  const botBits = new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles]);
  const guild = {
    id: '1', ownerId: '9', roles: { cache: roles }, members: { cache: new Collection(), me: { id: 'bot' } },
    channels: { cache: new Collection([[CHANNEL, channel]]), fetch: async (id) => (id === CHANNEL ? channel : null) },
  };
  guild.members.me.permissions = botBits;
  channel.permissionsFor = (who) => (who === guild.members.me ? botBits : bits);
  const message = {
    guild, channel, channelId: CHANNEL, client: {},
    author: { id: '2' }, content: '',
    member: { id: '2', permissions: new PermissionsBitField(manageRoles ? [PermissionFlagsBits.ManageRoles] : []), roles: { highest: { position: 5 } } },
    attachments: new Collection(attachments.map((file, index) => [String(index), file])),
    reply: async (payload) => { replies.push(payload); return { edit: async (next) => { replies.push(next); } }; },
  };
  return { message, sent, replies, channel };
}

const textOf = (replies) => JSON.stringify(replies[replies.length - 1]);

(async () => {
  // The channel comes first and the message keeps its line breaks.
  let w = world();
  let i = await buildInteractionFromMessage(w.message, send, `<#${CHANNEL}> hello\nsecond line`);
  await send.execute(i);
  assert.equal(w.sent[0].content, 'hello\nsecond line');
  assert.ok(textOf(w.replies).includes('Sent in'));

  // No channel: the current one. Pictures and videos attached to the command go with it, as files.
  w = world({ attachments: [{ url: 'https://cdn.test/a.png', name: 'a.png', description: null }, { url: 'https://cdn.test/b.mp4', name: 'b.mp4', description: null }] });
  i = await buildInteractionFromMessage(w.message, send, 'look https://petto.sbs');
  await send.execute(i);
  assert.equal(w.sent[0].content, 'look https://petto.sbs');
  assert.deepEqual(w.sent[0].files.map((file) => file.name), ['a.png', 'b.mp4']);

  // Only files: allowed. Nothing at all: asked what to send.
  w = world({ attachments: [{ url: 'https://cdn.test/a.png', name: 'a.png', description: null }] });
  await send.execute(await buildInteractionFromMessage(w.message, send, ''));
  assert.equal(w.sent.length, 1);
  w = world();
  await send.execute(await buildInteractionFromMessage(w.message, send, ''));
  assert.equal(w.sent.length, 0);

  // Pings: a role anyone can mention pings; one that is not mentionable does not, unless the sender may mention everyone.
  w = world();
  await send.execute(await buildInteractionFromMessage(w.message, send, `<@&${ROLE}> <@&${HIGH}> @everyone`));
  assert.deepEqual(w.sent[0].allowedMentions, { parse: ['users'], roles: [ROLE] });
  w = world({ permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.MentionEveryone] });
  await send.execute(await buildInteractionFromMessage(w.message, send, '@everyone hi'));
  assert.deepEqual(w.sent[0].allowedMentions, { parse: ['users', 'roles', 'everyone'] });

  // Without Manage Messages in the channel nothing is sent.
  w = world({ permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  await send.execute(await buildInteractionFromMessage(w.message, send, 'hi'));
  assert.equal(w.sent.length, 0);

  // An embed code with buttons: link buttons are free; a button that gives a role needs Manage Roles and a role below the sender.
  const code = (action) => `{embed}$v{description: Hi {user.mention}}$v{button: green && Go && ${action}}`;
  w = world();
  await send.execute(await buildInteractionFromMessage(w.message, send, code('https://petto.sbs')));
  assert.equal(w.sent[0].embeds.length, 1);
  assert.equal(w.sent[0].components[0].components[0].data.style, 5);
  w = world();
  await send.execute(await buildInteractionFromMessage(w.message, send, code('role:@Members')));
  assert.equal(w.sent.length, 0, 'a role button needs Manage Roles');
  w = world({ manageRoles: true });
  await send.execute(await buildInteractionFromMessage(w.message, send, code('role:@Members')));
  assert.ok(w.sent[0].components[0].components[0].data.custom_id.startsWith('eb:t'));
  w = world({ manageRoles: true });
  await send.execute(await buildInteractionFromMessage(w.message, send, code('role:@Boss')));
  assert.equal(w.sent.length, 0, 'a role above the sender can not be put in a button');
  w = world({ manageRoles: true });
  await send.execute(await buildInteractionFromMessage(w.message, send, code('embed:nothing:dm')));
  assert.equal(w.sent.length, 0, 'a saved embed that does not exist is refused');
  w = world();
  await send.execute(await buildInteractionFromMessage(w.message, send, code('embed:rules:dm')));
  assert.equal(w.sent.length, 1, 'showing a saved embed needs no role permission');

  // The channel in every way it is written, from another channel: a mention, an ID, a link, `#name`, a name with emojis around it,
  // at the end (the order the help showed), and a thread. A channel that is written but does not exist is said, never replaced.
  const OTHER = '555555555555555555';
  const THREAD = '666666666666666666';
  function twoChannels(options) {
    const w2 = world(options);
    const there = [];
    const bits = w2.channel.permissionsFor(null);
    const botBits = w2.channel.permissionsFor(w2.message.guild.members.me);
    const make = (id, name, extra = {}) => ({ id, name, guildId: '1', isTextBased: () => true, permissionsFor: (who) => (who === w2.message.guild.members.me ? botBits : bits), send: async (payload) => { there.push({ id, payload }); return { url: 'https://discord.com/channels/1/5/6' }; }, ...extra });
    w2.channel.name = 'general';
    w2.message.guild.channels.cache.set(OTHER, make(OTHER, '📢・anuncios'));
    w2.message.guild.channels.cache.set(THREAD, make(THREAD, 'hilo', { isThread: () => true, sendable: true }));
    return { ...w2, there };
  }
  for (const [typed, expected, rest] of [
    [`<#${OTHER}> hola`, OTHER, 'hola'], [`${OTHER} hola`, OTHER, 'hola'], [`https://discord.com/channels/1/${OTHER} hola`, OTHER, 'hola'],
    ['#anuncios hola', OTHER, 'hola'], ['anuncios hola\nmundo', OTHER, 'hola\nmundo'], [`hola <#${OTHER}>`, OTHER, 'hola'], ['hola #anuncios', OTHER, 'hola'],
  ]) {
    w = twoChannels();
    await send.execute(await buildInteractionFromMessage(w.message, send, typed));
    assert.equal(w.sent.length, 0, `${typed}: nothing is sent where the command was typed`);
    assert.equal(w.there[0]?.id, expected, `${typed}: sent to the channel written`);
    if (rest) assert.equal(w.there[0].payload.content, rest, `${typed}: the message without the channel`);
  }
  w = twoChannels();
  await send.execute(await buildInteractionFromMessage(w.message, send, 'anuncios'));
  assert.equal(w.sent[0].content, 'anuncios', 'a single word that is the name of a channel is the message');
  for (const typed of ['<#777777777777777777> hola', '#nada hola']) {
    w = twoChannels();
    await send.execute(await buildInteractionFromMessage(w.message, send, typed));
    assert.equal(w.sent.length + w.there.length, 0, `${typed}: a channel that does not exist sends nothing`);
    assert.ok(textOf(w.replies).includes('cannot find the channel'), `${typed}: and says so`);
  }
  // A thread asks for Send Messages in Threads, not Send Messages.
  w = twoChannels({ permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ManageMessages] });
  await send.execute(await buildInteractionFromMessage(w.message, send, `<#${THREAD}> hola`));
  assert.equal(w.there.length, 0, 'the bot without Send Messages in Threads sends nothing');
  w.message.guild.members.me.permissions.add(PermissionFlagsBits.SendMessagesInThreads);
  await send.execute(await buildInteractionFromMessage(w.message, send, `<#${THREAD}> hola`));
  assert.equal(w.there[0]?.id, THREAD, 'a thread takes the message with Send Messages in Threads');
  // The slash command: the option gives a channel, or only its data for a thread out of the cache.
  w = twoChannels();
  const slash = (picked) => ({
    guild: w.message.guild, channel: w.channel, channelId: CHANNEL, member: w.message.member, user: { id: '2' },
    options: { getChannel: () => picked, getString: (name) => (name === 'message' ? 'hola' : null), getAttachment: () => null },
    deferReply: async () => {}, editReply: async (payload) => { w.replies.push(payload); },
  });
  await send.execute(slash({ id: OTHER, type: 0, name: 'anuncios' }));
  assert.equal(w.there[0]?.id, OTHER, 'a channel given only as data is found');
  // The help of the command shows the channel first.
  assert.equal(send.data.toJSON().options[0].name, 'channel');

  // `!welcome setup #channel {embed}...`: the code is the message, not the name of a saved embed.
  w = world();
  w.message.guild.channels.cache.set(CHANNEL, w.channel);
  const long = '{embed}$v{title: Welcome {user.mention}}\n$v{description: Read the rules}$v{button: green && Rules && embed:rules}';
  i = await buildInteractionFromMessage(w.message, welcome, `setup <#${CHANNEL}> ${long}`);
  assert.equal(i.options.getString('message'), long);
  assert.equal(i.options.getString('embed'), null);
  assert.equal(i.options.getChannel('channel').id, CHANNEL);
  // A plain message keeps the usual way of reading the options.
  i = await buildInteractionFromMessage(w.message, welcome, `setup <#${CHANNEL}> --message "Welcome {user.mention}"`);
  assert.equal(i.options.getString('message'), 'Welcome {user.mention}');
  console.log('Checked !send and embed codes in the welcome messages.');
})().catch((error) => { console.error(error); process.exit(1); });
