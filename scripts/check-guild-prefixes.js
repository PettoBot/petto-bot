// The several prefixes of a server: the limits of a prefix, how a message is matched with them (symbol, word, longest first, the
// prefix of one person) and what the handler does with a message that starts with a prefix but is not a command. The database and the
// other modules are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// ---- the rules, on their own -----------------------------------------------------------------------------------------------------
const gp = require('../src/utils/guildPrefixes');

assert.deepEqual(gp.DEFAULT_PREFIXES, ['!', 'petto'], 'the defaults are ! and petto (the comma is only an option)');
assert.equal(gp.MAX_PREFIXES, 10);
assert.equal(gp.MAX_LENGTH, 12);

// A prefix: 1 to 12 characters, no spaces, no @ and no backticks.
for (const good of ['!', ',', '?', 'petto', 'p!', '>>', '!'.repeat(12), 'a'.repeat(12), '$', '.']) assert.equal(gp.validatePrefix(good).prefix, good, `${good} is fine`);
assert.equal(gp.validatePrefix('  ?  ').prefix, '?', 'the edges are cut');
for (const bad of ['', '   ', 'a'.repeat(13), 'p !', 'a b', '@', 'a@', '<@123>', '`', 'a`b', '\t']) assert.ok(gp.validatePrefix(bad).error, `${JSON.stringify(bad)} is refused`);
assert.match(gp.validatePrefix('a'.repeat(13), 'es').error, /12 caracteres/);
assert.match(gp.validatePrefix('a b', 'pt-BR').error, /espaços/);
assert.match(gp.validatePrefix('a@').error, /@/);

// A word is typed with a space; a symbol is attached.
assert.equal(gp.isWordPrefix('petto'), true);
assert.equal(gp.isWordPrefix('p!'), false);
assert.equal(gp.isWordPrefix(','), false);
assert.equal(gp.isWordPrefix('bot2'), true);

// The list: at most 10, no repeats (the case does not count), the last one cannot be removed.
let list = ['!'];
for (const p of ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'i1']) { const r = gp.addToList(list, p); assert.ok(r.prefixes, p); list = r.prefixes; }
assert.equal(list.length, 10);
assert.match(gp.addToList(list, 'j1').error, /up to 10 prefixes/);
assert.match(gp.addToList(['!', 'petto'], 'PETTO').error, /already/, 'a repeat in another case is a repeat');
assert.match(gp.addToList(['!'], '!').error, /already/);
assert.deepEqual(gp.addToList(['!'], ',').prefixes, ['!', ',']);
assert.deepEqual(gp.removeFromList(['!', 'petto'], 'PETTO').prefixes, ['!']);
assert.match(gp.removeFromList(['!', 'petto'], '?').error, /not one of/);
assert.match(gp.removeFromList(['!'], '!').error, /only prefix/);
assert.deepEqual(gp.validateList(['!', 'petto', ',']).prefixes, ['!', 'petto', ',']);
assert.ok(gp.validateList([]).error);
assert.ok(gp.validateList(['!', '!']).error, 'a repeated prefix in a list is refused');
assert.ok(gp.validateList(Array.from({ length: 11 }, (_, i) => `x${i}`)).error, 'eleven prefixes are too many');
assert.equal(gp.validateList(Array.from({ length: 10 }, (_, i) => `x${i}`)).prefixes.length, 10);
assert.ok(gp.validateList(['ok', 'a b']).error);
assert.ok(gp.validateList('!').error, 'a list that is not a list is refused');

// What a server has: the saved list, or its old prefix, or `!`.
assert.deepEqual(gp.prefixesOf({ prefix: '!', prefixes: ['!', 'petto'] }), ['!', 'petto']);
assert.deepEqual(gp.prefixesOf({ prefix: '?', prefixes: null }), ['?'], 'a server with a custom prefix keeps exactly that one');
assert.deepEqual(gp.prefixesOf({ prefix: 'p!' }), ['p!']);
assert.deepEqual(gp.prefixesOf({ prefix: '!', prefixes: [] }), ['!']);
assert.deepEqual(gp.prefixesOf(null), ['!']);
assert.deepEqual(gp.prefixesOf({ prefixes: ['?', '?', ' '] }), ['?'], 'repeats and blanks are dropped');
assert.equal(gp.primaryPrefix({ prefixes: [',', '!'], prefix: ',' }), ',');
assert.deepEqual(gp.columnsFor(['?', '!']), { prefixes: ['?', '!'], prefix: '?' }, 'the old column keeps the main prefix');

// ---- matching --------------------------------------------------------------------------------------------------------------------
const known = new Set(['help', 'ban', 'ping']);
const isKnown = async (name) => known.has(name);
const match = (content, prefixes = ['!', 'petto'], personal = null) => gp.matchPrefix(content, { prefixes, personal, isKnown });

(async () => {
  // A symbol prefix is attached to the command.
  let way = await match(',help', ['!', 'petto', ',']);
  assert.equal(way.commandName, 'help'); assert.equal(way.typedPrefix, ','); assert.equal(way.main, false);
  way = await match('!ban @a being rude');
  assert.equal(way.commandName, 'ban'); assert.equal(way.argText, '@a being rude'); assert.equal(way.main, true);
  assert.equal(await match(', es el mejor', ['!', 'petto', ',']), null, 'a space after a symbol prefix is not a command');
  assert.equal(await match('! hola'), null, 'a space after the main symbol prefix is not a command either');
  assert.equal(await match('!'), null);
  assert.equal(await match(','), null);
  assert.equal(await match('hello !help'), null, 'the prefix is at the start');

  // A word prefix: a space and a real command, in any case.
  way = await match('petto help');
  assert.equal(way.commandName, 'help'); assert.equal(way.word, true); assert.equal(way.typedPrefix, 'petto ');
  way = await match('PeTTo   BAN @a');
  assert.equal(way.commandName, 'ban'); assert.equal(way.argText, '@a'); assert.equal(way.typedPrefix, 'PeTTo ', 'what was typed is kept');
  assert.equal(await match('pettohelp'), null, 'a word prefix needs a space');
  assert.equal(await match('petto es el mejor'), null, 'chat that starts with the word is not a command');
  assert.equal(await match('petto'), null);
  assert.equal(await match('petto,help'), null);
  assert.equal(await match('petto, help'), null);

  // The longest prefix first.
  way = await match('!!help', ['!', '!!']);
  assert.equal(way.commandName, 'help'); assert.equal(way.typedPrefix, '!!');
  way = await match('!help', ['!!', '!']);
  assert.equal(way.commandName, 'help'); assert.equal(way.typedPrefix, '!');
  way = await match('!!help', ['!']);
  assert.equal(way.commandName, '!help', 'with only !, the rest is the word');
  way = await match('petto help', ['!', 'pet', 'petto']);
  assert.equal(way.typedPrefix, 'petto ');

  // The prefix of a person works too, next to the server's, and it can be longer than the server's.
  way = await match('p!help', ['!', 'petto'], 'p!');
  assert.equal(way.commandName, 'help'); assert.equal(way.source, 'personal'); assert.equal(way.main, false);
  way = await match('!!help', ['!', 'petto'], '!!');
  assert.equal(way.typedPrefix, '!!'); assert.equal(way.source, 'personal', 'the longest wins, also against the server');
  way = await match('!help', ['!', 'petto'], '!!');
  assert.equal(way.source, 'server');
  way = await match('!help', ['!'], '!');
  assert.equal(way.source, 'server', 'a personal prefix the server has too is the server one');
  assert.equal(await match('p! help', ['!'], 'p!'), null, 'the personal prefix is a symbol one too');

  // When an unknown word is answered: only the main prefix of the server, written like a command.
  assert.equal(gp.answersUnknown(await match('!es el mejor')), true, 'the main prefix keeps answering');
  assert.equal(gp.answersUnknown(await match(',es el mejor', ['!', ','])), false, 'a second prefix stays silent');
  assert.equal(gp.answersUnknown(await match(',help', ['!', ','])), false);
  assert.equal(gp.answersUnknown(await match('!!!', ['!'])), false, 'something that is not written like a command is silent');
  assert.equal(gp.answersUnknown(await match('...', ['.'])), false);
  assert.equal(gp.answersUnknown(await match('petto help')), false, 'a word prefix never answers');
  assert.equal(gp.answersUnknown(await match('p!nothing', ['!'], 'p!')), false, 'a personal prefix stays silent');
  assert.equal(gp.answersUnknown(await match(',es el mejor', [',', '!'])), true, 'the main one is the first of the list, whichever it is');

  await handler();
  console.log('Checked the prefixes of a server: limits, matching and what stays silent.');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

// ---- the message handler ---------------------------------------------------------------------------------------------------------
async function handler() {
  for (const file of ['src/db/disabledCommands.js', 'src/db/permissions.js', 'src/db/embedTemplates.js', 'src/utils/embedBuilder.js', 'src/utils/embedVariables.js', 'src/utils/messageFlags.js', 'src/utils/autoModControl.js', 'src/utils/usageCard.js']) stub(file, {});
  stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
  stub('src/utils/cardService.js', { plainMessage: async (text) => ({ content: text }) });
  stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
  stub('src/utils/emojis.js', { EMOJI: new Proxy({}, { get: () => '' }) });
  stub('src/utils/codeCommands.js', { runCodeCommand: async () => true });
  stub('src/logging/extraLog.js', { logCommandUse() {} });
  stub('src/utils/messageFlags.js', { extractReactReplies: (text) => ({ text, emojis: [] }), extractReactRepliesFromTemplate: (data) => data, applyReactReplies: async () => {} });
  stub('src/utils/embedVariables.js', { resolve: async (text) => text });
  stub('src/utils/usageCard.js', { unknownSubcommandCard: () => ({ text: 'usage' }), missingOptionCard: () => ({ text: 'missing' }) });
  stub('src/utils/moderationPermissions.js', { hasConfiguredRole: async () => false });
  stub('src/utils/commandRestrictions.js', { restrictedFor: async () => null, applyWordRoute: () => null });
  stub('src/utils/sharedCooldown.js', { getRemainingCooldownShared: async () => 0 });
  stub('src/db/disabledCommands.js', { findCached: async () => null });
  stub('src/db/permissions.js', { hasCommandPermission: async () => true });
  stub('src/utils/codeTriggers.js', { findTrigger: async () => null });
  stub('src/handlers/prefixInteraction.js', {
    tokenize: (text) => text.split(/\s+/).filter(Boolean),
    buildInteractionFromMessage: async (message, command, argText) => ({ options: { getSubcommand: () => null }, argText, deferred: false, replied: false, reply: async () => {} }),
  });
  const guild = { prefix: '!', prefixes: ['!', 'petto', ','] };
  stub('src/db/guilds.js', { ensureGuild: async () => guild });
  const serverAliases = new Map([['hola', { command: 'ping' }]]);
  stub('src/db/commandAliases.js', { get: async (guildId, name) => serverAliases.get(name) ?? null });
  const custom = new Map([['saludo', { name: 'saludo', response: 'hola!', trigger_type: null }], ['own', { name: 'own', response: 'x', trigger_type: 'prefix' }]]);
  stub('src/db/customCommands.js', { getCommand: async (guildId, name) => custom.get(name) ?? null });
  let personal = null;
  stub('src/utils/userPrefixAccess.js', { activeUserPrefix: async () => personal });

  const event = require('../src/events/messageCreateCommands');
  const ran = [];
  const command = { data: { toJSON: () => ({ type: 1 }) }, async execute(interaction) { ran.push(interaction.typedPrefix); } };
  const client = { user: { id: '123' }, commands: new Map([['help', command], ['ban', command], ['ping', command]]), commandAliases: new Map([['h', 'help']]), commandRoutes: new Map() };
  let n = 0;
  async function send(content) {
    const sent = [];
    ran.length = 0;
    const message = {
      content, sent, author: { id: '1', bot: false }, guild: { id: `9${n++}` }, member: { permissions: { has: () => true } },
      channel: { id: '5', sendTyping: async () => {}, send: async () => ({}) }, client,
      reply: async (payload) => { sent.push(payload); return { delete: async () => {} }; },
    };
    event.setCachedPrefix(message.guild.id, guild.prefixes);
    await event.execute(message);
    return { sent, ran: [...ran] };
  }

  // Real commands run under every prefix of the server.
  assert.deepEqual((await send('!help')).ran, ['!']);
  assert.deepEqual((await send(',help')).ran, [','], 'the comma, when the server has added it');
  assert.deepEqual((await send('petto help')).ran, ['petto '], 'the word prefix keeps its space for the replies');
  assert.deepEqual((await send('PETTO ban @a')).ran, ['PETTO ']);
  assert.deepEqual((await send('!h')).ran, ['!'], 'an alias too');
  assert.deepEqual((await send('petto h')).ran, ['petto ']);
  assert.deepEqual((await send('petto hola')).ran, ['petto '], 'and a server alias');
  // A custom command answers to every prefix (and to the word one only when it is a real command).
  let r = await send('petto saludo'); assert.equal(r.sent.length, 1, 'a custom command answers to the word prefix');
  r = await send(',saludo'); assert.equal(r.sent.length, 1, 'and to the comma');
  r = await send('!saludo'); assert.equal(r.sent.length, 1);
  r = await send('petto own'); assert.equal(r.sent.length, 0, 'a command with a prefix of its own is not set off by the prefix of Petto');
  // Chat that starts like a prefix is left alone: no command, no reply.
  for (const chat of [', es el mejor', 'petto es el mejor', '! hola', 'Petto, hola', 'petto', ',', '!', ',es el mejor', ',,,', '!!!']) {
    r = await send(chat);
    assert.deepEqual(r, { sent: [], ran: [] }, `${JSON.stringify(chat)} is chat`);
  }
  // The main prefix keeps answering "I don't know that command".
  r = await send('!es el mejor');
  assert.equal(r.sent.length, 1, 'the main prefix answers to an unknown command');
  assert.match(r.sent[0].components[0].text, /es/);
  assert.equal(r.ran.length, 0);
  r = await send('<@123> es el mejor');
  assert.equal(r.sent.length, 1, 'an @mention too');
  assert.deepEqual((await send('<@123> help')).ran, ['<@123>']);
  // A person with a prefix of their own: it works, and it is silent for an unknown word.
  personal = 'p!';
  assert.deepEqual((await send('p!help')).ran, ['p!']);
  assert.deepEqual(await send('p!es el mejor'), { sent: [], ran: [] });
  assert.deepEqual((await send('!help')).ran, ['!'], 'the prefixes of the server still work');
  personal = null;
  // A server with one custom prefix keeps exactly that one.
  guild.prefix = '?'; guild.prefixes = ['?'];
  assert.deepEqual((await send('?help')).ran, ['?']);
  assert.deepEqual(await send('!help'), { sent: [], ran: [] }, 'the old default does not work when the server chose another prefix');
  assert.deepEqual(await send('petto help'), { sent: [], ran: [] });
  assert.equal((await send('?nothing')).sent.length, 1, 'its only prefix is the main one');
  // The suggestion channel, the autoresponders and the rest ask the same question.
  guild.prefix = '!'; guild.prefixes = ['!', 'petto', ','];
  const asked = async (content) => { const m = { content, guild: { id: 'zz' }, author: { id: '1' }, client }; event.setCachedPrefix('zz', guild.prefixes); return event.isCommandMessage(m); };
  assert.equal(await asked(',help'), true);
  assert.equal(await asked('petto help'), true);
  assert.equal(await asked('petto es el mejor'), false);
  assert.equal(await asked(', help'), false);
}
