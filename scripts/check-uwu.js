// Checks !uwu: the text is softened the same way every time, and mentions, links, code, custom emojis, emojis and Markdown come out as
// they went in; nobody can be pinged; a long text is cut under Discord's limit without cutting a code block or a link in half; the
// command takes the text typed, or the message it answers, and says what is wrong when there is none.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { uwuify, uwuLanguage, FACES, MAX_FACES, MESSAGE_LIMIT } = require('../src/utils/uwu');
const { loadCommands } = require('../src/handlers/commandHandler');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');

// Same text, same result.
const sample = 'Hello world, this is really lovely! Do you want to go outside? Not really.';
assert.equal(uwuify(sample), uwuify(sample), 'the same text always gives the same result');
assert.equal(uwuify(sample), 'Hewwo wowwd, t-this is weawwy wuvwy! ^w^ Do y-you want to go outside? Nyot weawwy. uwu', 'a fixed example, to notice any change of the rules');
assert.equal(uwuify('Really, really.'.repeat(1)), uwuify('Really, really.'));
// English: l and r are softened, n before a vowel becomes ny, case is kept.
assert.equal(uwuify('Little river'), 'W-Wittwe wivew ^w^');
assert.equal(uwuify('NOT NICE'), 'NYOT N-NYICE ^w^', 'capitals stay capitals');
assert.equal(uwuify('Short.'), 'S-Showt. nya~');
assert.ok(!/[lrLR]/.test(uwuify('lol rare').replace(/uwu|owo|nya~|\^w\^/g, '')), 'no l or r is left in a plain English text');

// Spanish and Portuguese stay readable: only the r that ends a long word and n before a vowel change.
const es = uwuify('Me encanta cantar con mi amor. Nada es mejor.', { lang: 'es' });
assert.ok(es.includes('cantaw') && es.includes('amow') && es.includes('Nyada'), es);
assert.ok(es.includes('Me') && es.includes('con mi'), 'the rest of the Spanish text is untouched');
assert.ok(uwuify('Olá, eu adoro cantar.', { lang: 'pt-BR' }).includes('cantaw'));
assert.equal(uwuLanguage('es'), 'es');
assert.equal(uwuLanguage('es-419'), 'es');
assert.equal(uwuLanguage('pt-BR'), 'pt');
assert.equal(uwuLanguage('de'), 'en');
assert.equal(uwuLanguage(undefined), 'en');

// Mentions, links, code, emojis, timestamps and Markdown are left as they were.
const keep = [
  '<@123456789012345678>', '<@!123456789012345678>', '<@&123456789012345678>', '<#123456789012345678>',
  '<:wave:123456789012345678>', '<a:dance:123456789012345678>', '<t:1700000000:R>', '</act:123456789012345678>',
  'https://example.com/really_long_path?l=r&x=1#frag', '<https://example.com/a>', 'www.example.com/lorem',
  '`inline code l r`', '```js\nconst l = r;\nconsole.log("really");\n```', ':smile:', '😀', '👍🏽', '🏳️‍🌈',
];
for (const piece of keep) {
  const result = uwuify(`Look at ${piece} really now.`);
  assert.ok(result.includes(piece), `${piece} comes out untouched: ${result}`);
  assert.ok(result.startsWith('Wook'), 'and the words around it are softened');
}
const markdown = uwuify('**really bold** __under__ ~~strike~~ ||secret|| > quote line\n# Heading\n- item one');
assert.ok(markdown.includes('**') && markdown.includes('__') && markdown.includes('~~') && markdown.includes('||') && markdown.includes('> ') && markdown.includes('# ') && markdown.includes('- '), markdown);
assert.equal((markdown.match(/\*\*/g) ?? []).length, 2, 'bold stays a pair');
assert.ok(markdown.includes('\n'), 'line breaks stay');
assert.ok(uwuify('Numbers 123 and 4.5 stay').includes('123') && uwuify('Numbers 123 and 4.5 stay').includes('4.5'));
// A code block that is not closed is code to the end: nothing in it changes, and no face is put inside it.
const open = uwuify('Before.\n```\nconst l = r;');
assert.ok(open.endsWith('const l = r;'), open);

// Nobody can be pinged.
for (const text of ['@everyone', '@here hello', 'hey @everyone and @here', 'x@everyone', '@EVERYONE']) {
  const result = uwuify(text);
  assert.ok(!/@(everyone|here)/i.test(result), `${text} cannot ping: ${JSON.stringify(result)}`);
  assert.ok(result.includes('@​'), 'with an invisible character after the @');
}
assert.ok(uwuify('mail me at ana@example.com please').includes('ana@example.com'), 'an e-mail address is not changed');

// Empty input.
for (const empty of ['', '   ', '\n\t', null, undefined, 42]) assert.equal(uwuify(empty), '', `${JSON.stringify(empty)} is empty`);

// Faces: a few, never too many, and the text always has one at the end when it has no sentence.
const many = uwuify('Hello there. '.repeat(200), { limit: 100000 });
const faces = (many.match(/uwu|owo|nya~|\^w\^/g) ?? []).length;
assert.ok(faces <= MAX_FACES, `${faces} faces in a long text`);
assert.ok(FACES.some((face) => uwuify('no ending here').endsWith(face)), 'a text with no sentence end gets a face at its end');

// Length: Discord's limit, cut at a word, with a mark, and a code block or a link is never cut in half.
assert.equal(MESSAGE_LIMIT, 2000);
for (const text of ['hello world '.repeat(900), 'x'.repeat(5000), 'word. '.repeat(1000), 'ñandú 😀 '.repeat(800), '🏳️‍🌈'.repeat(1500)]) {
  const result = uwuify(text);
  assert.ok(result.length <= MESSAGE_LIMIT, `${result.length} characters`);
  assert.ok(result.endsWith('…'), 'a cut text ends with a mark');
  assert.ok(!/[\ud800-\udbff]…?$/.test(result), 'no half of a pair of characters is left');
}
const block = '```\n' + 'l r '.repeat(300) + '\n```';
const cutBlock = uwuify(`Intro text here. ${block} ${block}`);
assert.ok(cutBlock.length <= 2000);
assert.equal((cutBlock.match(/```/g) ?? []).length % 2, 0, 'a code block is whole or left out');
const link = 'https://example.com/' + 'a'.repeat(100);
const cutLink = uwuify(`${'word '.repeat(390)}${link}`);
assert.ok(cutLink.length <= 2000 && (!cutLink.includes('https://') || cutLink.includes(link)), 'a link is whole or left out');
assert.equal(uwuify('short', { limit: 8 }).length <= 8, true);
assert.ok(uwuify('a text that is longer than the limit', { limit: 10 }).length <= 10);

// The command: typed text, a replied message, nothing, and the way it answers.
(async () => {
  const client = { commands: new Collection() };
  loadCommands(client);
  const uwu = client.commands.get('uwu');
  assert.ok(uwu && client.commandAliases.get('uwuify') === 'uwu');
  assert.equal(uwu.category, 'fun');
  assert.equal(uwu.cooldownMs, 3000);
  const { isSlashCommand } = require('../src/handlers/commandHandler');
  assert.equal(isSlashCommand(uwu), false, 'uwu is a prefix command: no new slash command');

  const author = { id: '111111111111111111', username: 'Ana', globalName: null, displayAvatarURL: () => 'x' };
  const sent = [];
  const base = {
    id: '555555555555555555', guild: { id: '444444444444444444', members: { cache: new Collection() } }, author, member: { user: author },
    client: { users: { fetch: async () => null }, commands: client.commands },
    channel: { id: '666666666666666666', send: async (payload) => { sent.push(payload); } },
    attachments: new Collection(),
  };
  async function run(content, extra = {}) {
    sent.length = 0;
    const message = { ...base, ...extra, content, reply: async (payload) => { sent.push(payload); return { edit: async () => {} }; } };
    const interaction = await buildInteractionFromMessage(message, uwu, content.replace(/^!uwu\s*/, ''));
    interaction.pettoLang = 'en';
    interaction.typedPrefix = '!';
    await uwu.execute(interaction);
    return sent.at(-1);
  }

  const typed = await run('!uwu Hello really\n```\nl r\n```\n<@123456789012345678> @everyone');
  assert.ok(typed.content.startsWith('Hewwo weawwy\n```\nl r\n```\n<@123456789012345678> @​everyone'), JSON.stringify(typed.content));
  assert.deepEqual(typed.allowedMentions.parse, [], 'it pings nobody');
  assert.equal(typed.allowedMentions.repliedUser, false);

  // A reply: the text of the message that is answered.
  const replied = await run('!uwu', { reference: { messageId: '999999999999999999' }, fetchReference: async () => ({ content: 'Please read this', embeds: [] }) });
  assert.ok(replied.content.startsWith('P-Pwease wead'), replied.content);
  // A reply to a message with an embed and no text.
  const repliedEmbed = await run('!uwu', { reference: { messageId: '999999999999999999' }, fetchReference: async () => ({ content: '', embeds: [{ description: 'Embed text' }] }) });
  assert.ok(repliedEmbed.content.startsWith('Embed'), repliedEmbed.content);
  // Typed text wins over the reply.
  const both = await run('!uwu mine', { reference: { messageId: '9' }, fetchReference: async () => ({ content: 'theirs', embeds: [] }) });
  assert.ok(both.content.startsWith('minye'), both.content);
  assert.ok(!/their/.test(both.content));
  // Nothing: a notice with how to write it (no text, no reply, a reply with no text).
  for (const extra of [{}, { reference: { messageId: '9' }, fetchReference: async () => ({ content: '', embeds: [] }) }, { reference: { messageId: '9' }, fetchReference: async () => { throw new Error('gone'); } }]) {
    const none = await run('!uwu', extra);
    assert.ok(none.components && !none.content, 'a notice card, not a message of uwu');
    assert.ok(JSON.stringify(none.components).includes('!uwu'), 'it says how to write it');
  }
  // Only spaces are nothing too.
  assert.ok((await run('!uwu    ')).components);
  // The same in Spanish and Portuguese.
  for (const [lang, word] of [['es', 'cantaw'], ['pt-BR', 'cantaw']]) {
    sent.length = 0;
    const message = { ...base, content: '!uwu quiero cantar', reply: async (payload) => { sent.push(payload); return { edit: async () => {} }; } };
    const interaction = await buildInteractionFromMessage(message, uwu, 'quiero cantar');
    interaction.pettoLang = lang;
    await uwu.execute(interaction);
    assert.ok(sent.at(-1).content.includes(word), sent.at(-1).content);
  }

  console.log('Checked !uwu: the same result every time, mentions, links, code, emojis and Markdown kept, nobody pinged, the length, a reply and no text.');
  setTimeout(() => process.exit(0), 10);
})().catch((err) => { console.error(err); process.exit(1); });
