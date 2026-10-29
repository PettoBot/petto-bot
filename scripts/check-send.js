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
