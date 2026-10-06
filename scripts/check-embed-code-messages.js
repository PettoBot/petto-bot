// Checks the embed codes written in an autoresponder (`!ar add hi, {embed}$v{...} --reply --not_strict`) and the command
// that changes a message Petto sent (`!editembed <link> {embed}$v{...}`), against a fake server.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { verifyBaseUrl: null });
stub('src/db/guilds.js', { ensureGuild: async () => ({ prefix: '!' }) });
stub('src/db/embedTemplates.js', { getTemplate: async () => null });
stub('src/db/autoResponders.js', { create: async (guildId, patch) => ({ ar_id: 'abc12345', ...patch }), update: async (guildId, id, patch) => ({ ar_id: id, ...patch }) });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK' } });
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
stub('src/utils/embedVariables.js', { resolve: async (text) => text.replaceAll('{user.mention}', '@Liam').replaceAll('{guild.icon}', 'https://x.test/icon.png') });
stub('src/utils/cardService.js', { normalizeCardRef: () => null, renderCardForMessage: async () => null, CARD_FILE_NAME: 'card.png' });
const { dropTokens, takeFlags, splitTrigger, autoresponderAdd, autoresponderEdit, messageTarget, editMessage } = require('../src/utils/codeArgs');
const { parseEmbedScript, looksLikeScript } = require('../src/utils/embedScript');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const { payloadFromCode } = require('../src/utils/embedCodeMessage');
const autoresponder = require('../src/commands/automation/autoresponder');
const editembed = require('../src/commands/config/editembed');

// Flags are read outside of the code only.
assert.deepEqual(takeFlags('hi, {embed}$v{description: --reply inside} --reply --not_strict'), { text: 'hi, {embed}$v{description: --reply inside}', flags: { reply: true, not_strict: true } });
assert.deepEqual(takeFlags('x --mode exact y', ['mode']), { text: 'x  y', flags: { mode: 'exact' } });
assert.equal(dropTokens('add "two words" rest of it', 2), 'rest of it');

// The trigger: with a comma it can have spaces, quoted works, and the first word is the old way.
assert.deepEqual(splitTrigger('test, {embed}$v{description: a, b}'), { trigger: 'test', reply: '{embed}$v{description: a, b}' });
assert.deepEqual(splitTrigger('good morning, hello'), { trigger: 'good morning', reply: 'hello' });
assert.deepEqual(splitTrigger('"good morning" hello there'), { trigger: 'good morning', reply: 'hello there' });
assert.deepEqual(splitTrigger('hi Hello, friend'), { trigger: 'hi Hello', reply: 'friend' });
assert.deepEqual(splitTrigger('hi {embed}$v{description: a, b}'), { trigger: 'hi', reply: '{embed}$v{description: a, b}' }, 'a comma inside the code does not split the trigger');
assert.deepEqual(splitTrigger('hi hello there'), { trigger: 'hi', reply: 'hello there' });

// The example of another bot, with its flags: the unclosed {message: ...} block ends where the next block starts.
const code = '{embed}$v{message: {user.mention}$v{description: This is an example of an autoresponder!}$v{thumbnail: {guild.icon}}';
const read = parseEmbedScript(code);
assert.equal(read.content, '{user.mention}');
assert.equal(read.embed.description, 'This is an example of an autoresponder!');
assert.equal(read.embed.thumbnail, '{guild.icon}');
assert.ok(read.warnings.some((line) => line.includes('before the next block')));
assert.deepEqual(parseEmbedScript('{embed}$v{message: {user.mention}}$v{description: a}').warnings, [], 'a closed block says nothing');
assert.equal(looksLikeScript(code), true);
assert.equal(looksLikeScript('Hello {user.mention}, welcome {reactreply:🌸}'), false);

// Several embeds in one message, as in the other bot's example.
let built = await0(payloadFromCode('{embed}$v{description: 1,2}\n\n{embed}$v{description: 2,3}', {}));
function await0(value) { return value; }

const message = {
  guild: { id: '1', channels: { cache: new Collection() }, roles: { cache: new Collection() }, members: { cache: new Collection() } },
  author: { id: '2' }, member: { id: '2' }, channel: { id: '3' }, client: {}, content: '',
};
const parse = (command, text) => buildInteractionFromMessage(message, command, text);

(async () => {
  built = await built;
  assert.equal(built.payload.embeds.length, 2);
  assert.deepEqual(built.payload.embeds.map((embed) => embed.data.description), ['1,2', '2,3']);
  assert.equal((await payloadFromCode('{embed}', {})).payload, null, 'nothing to show');
  assert.ok((await payloadFromCode(`{embed}$v{title: ${'x'.repeat(300)}}`, {})).error, 'Discord would refuse it');
  const mixed = await payloadFromCode('hello {user.mention} {embed}$v{title: T}$v{button: link && Go && https://petto.sbs}', {});
  assert.equal(mixed.payload.content, 'hello @Liam');
  assert.equal(mixed.payload.components.length, 1);

  // `!autoresponder add`, as typed.
  let i = await parse(autoresponder, `add test, ${code} --reply --not_strict`);
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('trigger'), i.options.getString('reply'), i.options.getBoolean('reply_to_message'), i.options.getString('mode')], ['add', 'test', code, true, 'contains']);
  i = await parse(autoresponder, 'add "good morning" hello --strict --delete --ping');
  assert.deepEqual([i.options.getString('trigger'), i.options.getString('reply'), i.options.getString('mode'), i.options.getBoolean('delete_trigger'), i.options.getBoolean('ping_user')], ['good morning', 'hello', 'exact', true, true]);
  i = await parse(autoresponder, 'add hi --embed_template welcome');
  assert.deepEqual([i.options.getString('trigger'), i.options.getString('reply'), i.options.getString('embed_template')], ['hi', null, 'welcome']);
  i = await parse(autoresponder, 'add');
  assert.throws(() => i.options.getString('trigger', true), /Missing required argument/);
  // Line breaks and quotes of the code survive.
  i = await parse(autoresponder, 'add hi, {embed}$v{description: say "hi"\nnext line}');
  assert.equal(i.options.getString('reply'), '{embed}$v{description: say "hi"\nnext line}');
  i = await parse(autoresponder, 'edit abc12345 --reply {embed}$v{description: new}');
  assert.deepEqual([i.options.getSubcommand(), i.options.getString('id'), i.options.getString('reply'), i.options.getBoolean('reply_to_message')], ['edit', 'abc12345', '{embed}$v{description: new}', true]);
  i = await parse(autoresponder, 'list');
  assert.equal(i.options.getSubcommand(), 'list', 'the other subcommands read as before');

  // Saving it checks the code first.
  const replies = [];
  const fake = (options, member = {}) => ({
    replies,
    options: { getString: (key) => options[key] ?? null, getBoolean: () => null, getSubcommand: () => 'add', getSubcommandGroup: () => null },
    guild: { id: '1' }, channel: { id: '3' }, member, deferReply: async () => {}, editReply: async (value) => { replies.push(value); }, reply: async (value) => { replies.push(value); },
  });
  await autoresponder.execute(fake({ trigger: 'test', reply: code }));
  assert.ok(replies.at(-1).components[0].text.includes('Embed code'), 'an embed code is saved as one');
  assert.ok(replies.at(-1).components[0].text.includes('before the next block'));
  await autoresponder.execute(fake({ trigger: 'test', reply: `{embed}$v{title: ${'x'.repeat(300)}}` }));
  assert.ok(replies.at(-1).components[0].text.includes('refuse'));
  await autoresponder.execute(fake({ trigger: 'test', reply: 'just text' }));
  assert.ok(replies.at(-1).components[0].text.includes('Text'));

  // Where `!editembed` points.
  assert.deepEqual(messageTarget('https://discord.com/channels/1/22222222222222222/33333333333333333'), { guildId: '1', channelId: '22222222222222222', messageId: '33333333333333333' });
  assert.deepEqual(messageTarget('22222222222222222/33333333333333333'), { guildId: null, channelId: '22222222222222222', messageId: '33333333333333333' });
  assert.deepEqual(messageTarget('33333333333333333'), { guildId: null, channelId: null, messageId: '33333333333333333' });
  assert.equal(messageTarget('hello'), null);
  assert.deepEqual(editMessage('https://discord.com/channels/1/22222222222222222/33333333333333333 {embed}$v{title: A B}'), { message: 'https://discord.com/channels/1/22222222222222222/33333333333333333', code: '{embed}$v{title: A B}' });
  assert.deepEqual(editMessage('{embed}$v{title: only code}'), { code: '{embed}$v{title: only code}' });
  assert.deepEqual(editMessage('<#22222222222222222> 33333333333333333 hi'), { message: '22222222222222222/33333333333333333', code: 'hi' });

  // `!editembed` against a fake channel.
  const edits = [];
  const sent = { id: '33333333333333333', author: { id: 'bot' }, url: 'https://discord.com/channels/1/22222222222222222/33333333333333333', flags: { has: () => false }, edit: async (value) => { edits.push(value); } };
  const guild = { id: '1', channels: { fetch: async () => channel } };
  const channel = { id: '22222222222222222', isTextBased: () => true, permissionsFor: () => ({ has: () => true }), messages: { fetch: async (id) => (id === sent.id ? sent : Promise.reject(new Error('Unknown Message'))) } };
  const run = async (text, extra = {}) => {
    const out = [];
    const interaction = await buildInteractionFromMessage({ ...message, guild, ...extra }, editembed, text);
    interaction.guild = guild; interaction.member = {}; interaction.client = { user: { id: 'bot' } };
    interaction.editReply = async (value) => { out.push(value); };
    await interaction.execute?.();
    await editembed.execute(interaction);
    return out.at(-1).components[0].text;
  };
  let text = await run('https://discord.com/channels/1/22222222222222222/33333333333333333 {embed}$v{description: new}$v{embed}$v{description: two}');
  assert.ok(text.includes('Changed the message'));
  assert.equal(edits.at(-1).embeds.length, 2);
  assert.equal(edits.at(-1).content, null, 'the old text is cleared');
  assert.deepEqual(edits.at(-1).components, []);
  text = await run('{embed}$v{description: by reply}', { reference: { messageId: '33333333333333333' } });
  assert.ok(text.includes('Changed the message'));
  assert.equal(edits.at(-1).embeds[0].data.description, 'by reply');
  assert.ok((await run('99999999999999999 {embed}$v{description: x}')).includes('cannot find that message'));
  assert.ok((await run('33333333333333333')).includes('Write the new message'));
  assert.ok((await run('{embed}$v{description: x}')).includes('Say which message'));
  assert.ok((await run('https://discord.com/channels/7/22222222222222222/33333333333333333 {embed}$v{description: x}')).includes('another server'));
  sent.author.id = 'someone';
  assert.ok((await run('33333333333333333 {embed}$v{description: x}')).includes('only change messages that I sent'));
  sent.author.id = 'bot'; sent.flags = { has: (flag) => flag === MessageFlags.IsComponentsV2 };
  assert.ok((await run('33333333333333333 {embed}$v{description: x}')).includes('components layout'));
  sent.flags = { has: () => false };
  assert.ok((await run('33333333333333333 {embed}')).includes('nothing to show'));
  channel.permissionsFor = () => ({ has: () => false });
  assert.ok((await run('33333333333333333 {embed}$v{description: x}')).includes('Manage Messages'));

  console.log('Checked the embed codes in autoresponders and !editembed.');
})().catch((error) => { console.error(error); process.exit(1); });
