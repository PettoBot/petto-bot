// Checks the short aliases (`!is` is `!image sepia`) the way messages reach them: the prefix parser with the real commands and routes, the
// common words that never start a command after a word prefix (`petto is the best` is chat), and that `!disablecommand` and
// `!restrictcommand` rules of the real command apply to the short alias too. The database and Discord are replaced.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

/** The real module with some of its functions replaced (the others are needed by the commands that load with it). */
function patch(relative, overrides) {
  return Object.assign(require(path.join(__dirname, '..', relative)), overrides);
}

const disabled = []; // { command, channel_id }
const restricted = {}; // command -> role ids
const guildRow = { prefix: '!', prefixes: ['!', 'petto', ','] };
const serverAliases = new Map([['ya', { command: 'ping' }]]);
const custom = new Map([['lo', { name: 'lo', response: 'hello', trigger_type: null }]]);
stub('src/db/database.js', { from: () => ({}) });
patch('src/db/guilds.js', { ensureGuild: async () => guildRow });
patch('src/db/commandAliases.js', { get: async (guildId, name) => serverAliases.get(name) ?? null });
patch('src/db/customCommands.js', { getCommand: async (guildId, name) => custom.get(name) ?? null });
patch('src/db/disabledCommands.js', { findCached: async (guildId, command, channelId) => disabled.find((row) => row.command === command && (row.channel_id === null || row.channel_id === channelId)) ?? null, canonicalizeStored: async () => 0 });
patch('src/db/commandRestrictions.js', { restrictionMap: async () => restricted });
patch('src/db/permissions.js', { hasCommandPermission: async () => true });
patch('src/utils/sharedCooldown.js', { getRemainingCooldownShared: async () => 0 });
patch('src/utils/userPrefixAccess.js', { activeUserPrefix: async () => null });
patch('src/utils/codeTriggers.js', { findTrigger: async () => null });
patch('src/utils/codeCommands.js', { runCodeCommand: async () => true });
patch('src/logging/extraLog.js', { logCommandUse() {} });
patch('src/utils/cardService.js', { plainMessage: async (text) => ({ content: text }) });
patch('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const { loadCommands } = require('../src/handlers/commandHandler');
const event = require('../src/events/messageCreateCommands');

const client = { user: { id: '123' } };
loadCommands(client);

// Every command runs a spy that records what the parser made of the message.
const ran = [];
for (const command of client.commands.values()) {
  command.execute = async (interaction) => { ran.push([command.data.name, interaction.options.getSubcommandGroup?.(false), interaction.options.getSubcommand(false)].filter(Boolean).join(' ')); };
}
let n = 0;
async function send(content) {
  ran.length = 0;
  const sent = [];
  const message = {
    content, author: { id: '1', bot: false }, guild: { id: `7${n++}` }, client,
    member: { permissions: { has: (flag) => flag !== PermissionFlagsBits.Administrator }, roles: { cache: new Map() }, id: '1' },
    mentions: { users: new Map(), roles: new Map(), channels: new Map(), members: new Map() }, attachments: new Map(), reference: null,
    channel: { id: '5', sendTyping: async () => {}, send: async () => ({}) },
    reply: async (payload) => { sent.push(JSON.stringify(payload)); return { delete: async () => {} }; },
  };
  event.setCachedPrefix(message.guild.id, guildRow.prefixes);
  await event.execute(message);
  return { ran: [...ran], sent };
}

(async () => {
  // Every short alias of the table is read by the command parser as the subcommand it stands for (and, with the handler below, a good
  // sample of them runs: the others need an argument, which would only be asked for).
  const { SHORT_ALIAS_TABLE } = require('../src/utils/shortAliases');
  const { shortAliasRoutes } = require('../src/utils/shortAliases');
  const { resolveSubcommandOptions } = require('../src/handlers/prefixInteraction');
  const aliasOf = (target) => Object.keys(SHORT_ALIAS_TABLE).find((alias) => SHORT_ALIAS_TABLE[alias] === target);
  let count = 0;
  for (const route of shortAliasRoutes()) {
    const command = client.commands.get(route.command);
    assert.ok(command, `${route.alias}: ${route.command} is loaded`);
    const resolved = resolveSubcommandOptions(command.data.toJSON(), [...route.args]);
    const reached = [resolved?.subcommandGroup, resolved?.subcommand].filter(Boolean).join(' ');
    assert.equal(reached, route.subcommand ?? '', `!${route.alias} reaches ${SHORT_ALIAS_TABLE[route.alias]}`);
    count += 1;
  }
  assert.ok(count > 500, `${count} short aliases tried`);
  // Resolving a word is one Map lookup: the loader holds the routes in a Map (the Collection of client.commandRoutes).
  assert.ok(client.commandRoutes instanceof Map, 'the routes are in a Map');
  for (const route of shortAliasRoutes()) assert.equal(client.commandRoutes.get(route.alias), route, `${route.alias} is one Map.get away`);
  for (const [text, expected] of [
    ['!is', 'image sepia'], ['!is @someone', 'image sepia'], ['!iro 90', 'image rotate'], ['!ib', 'image blur'], ['!if', 'image flip'],
    ['!tko', 'ticket open'], [`!${aliasOf('afk set')}`, 'afk set'], [`!${aliasOf('welcome status')}`, 'welcome status'], [`!${aliasOf('feed list')}`, 'feed list'],
    // A symbol prefix that is not the main one, and the long forms, still work.
    [',is', 'image sepia'], ['!image sepia', 'image sepia'], ['!sepia', 'image sepia'], ['!ticket open', 'ticket open'],
    ['!editsnipe', 'snipe edited'], ['!esnipe', 'snipe edited'], ['!reactionsnipe', 'snipe reactions'], ['!clearsnipe', 'snipe clear'],
  ]) {
    const result = await send(text);
    assert.deepEqual(result.ran, [expected], `${text} runs ${expected}`);
  }

  // After a word prefix, an everyday word is chat; a command or a longer alias still runs.
  for (const chat of ['petto is the best', 'PETTO is the best', 'petto if you want', 'petto im tired', 'petto si quieres', 'petto um dia', 'petto an idea', 'petto la verdad', 'petto at home']) {
    const result = await send(chat);
    assert.deepEqual(result, { ran: [], sent: [] }, `${JSON.stringify(chat)} is chat: nothing runs and nothing is answered`);
  }
  for (const [text, expected] of [['petto sepia', 'image sepia'], ['petto image sepia', 'image sepia'], ['petto iro 90', 'image rotate'], ['petto ib', 'image blur'], ['petto tko', 'ticket open'], ['petto snipe', 'snipe deleted'], ['petto editsnipe', 'snipe edited']]) {
    assert.deepEqual((await send(text)).ran, [expected], `${text} still runs`);
  }
  // A server alias or a custom command chosen by the server keeps working with the word prefix even when it is an everyday word.
  assert.deepEqual((await send('petto ya')).ran, ['ping'], 'a server alias called ya');
  assert.equal((await send('petto lo')).sent.length, 1, 'a custom command called lo');
  // The matcher itself.
  const known = event.knownNameChecker(client, '1');
  assert.equal(await known('is'), false);
  assert.equal(await known('IS'.toLowerCase()), false);
  assert.equal(await known('sepia'), true);
  assert.equal(await known('image'), true);
  assert.equal(await known('help'), true);
  assert.equal(await known('iro'), true);

  // A word the server chose wins over a short alias: its custom command, or its own alias.
  custom.set('is', { name: 'is', response: 'mine', trigger_type: null });
  let own = await send('!is');
  assert.deepEqual([own.ran, own.sent.length], [[], 1], 'a custom command called is answers instead of image sepia');
  assert.deepEqual((await send('!ib')).ran, ['image blur'], 'the others are not touched');
  custom.delete('is');
  serverAliases.set('tko', { command: 'ping' });
  assert.deepEqual((await send('!tko')).ran, ['ping'], 'a server alias called tko runs what the server said');
  serverAliases.delete('tko');
  assert.deepEqual((await send('!tko')).ran, ['ticket open'], 'and the short alias is back when it goes');

  // `!disablecommand image` and `!restrictcommand image` apply to the short alias of its subcommands.
  disabled.push({ command: 'image', channel_id: null });
  for (const text of ['!is', '!ib', '!image sepia', '!sepia', ',is']) {
    const result = await send(text);
    assert.deepEqual(result.ran, [], `${text} is off when image is turned off`);
    assert.match(result.sent.join(''), /turned off|disabled/i, `${text} says why`);
  }
  assert.deepEqual((await send('!tko')).ran, ['ticket open'], 'another command is not touched');
  disabled.length = 0;
  disabled.push({ command: 'image', channel_id: '5' });
  assert.deepEqual((await send('!is')).ran, [], 'a rule for the channel applies to the alias in that channel');
  disabled.length = 0;
  disabled.push({ command: 'ticket', channel_id: null });
  assert.deepEqual((await send('!tko')).ran, [], 'the same for the ticket aliases');
  assert.deepEqual((await send('!is')).ran, ['image sepia'], 'and image runs again');
  disabled.length = 0;
  restricted.image = ['999'];
  let result = await send('!is');
  assert.deepEqual(result.ran, [], 'a role restriction of image applies to !is');
  result = await send('!iro 45');
  assert.deepEqual(result.ran, [], 'and to the others');
  assert.deepEqual((await send('!tko')).ran, ['ticket open'], 'another command is not restricted');
  delete restricted.image;
  assert.deepEqual((await send('!is')).ran, ['image sepia'], 'no rule, no problem');

  console.log('check-short-alias-use: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
