// Checks `!variables`: the list of options that are only written in the text (utils/commandFlags.ts) has a text in the three languages and points at commands that exist; every
// `--flag` that Petto reads or tells people about is either an option of a command (the prefix reads any option as `--name value`) or is in that list, so a new one cannot be forgotten;
// and the command answers in each language: the overview, the options of a command or of one of its subcommands, where an option is used, the flags and what it says when it finds nothing.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, MessageFlags } = require('discord.js');
const logger = require('../src/utils/logger');
for (const level of ['info', 'warn']) logger[level] = () => {};
const i18n = require('../src/i18n');
const { loadCommands, isSlashCommand } = require('../src/handlers/commandHandler');
const flags = require('../src/utils/commandFlags');
const command = require('../src/commands/info/variables.js');

const ROOT = path.join(__dirname, '..');
const text = (payload) => JSON.stringify(payload.components[0].toJSON());
const walkFiles = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walkFiles(path.join(dir, entry.name), ext) : entry.name.endsWith(ext) ? [path.join(dir, entry.name)] : []));

(async () => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.commands = new Collection();
  client.commandAliases = new Collection();
  client.prefixRoutes = new Map();
  await loadCommands(client);

  // ---- the command: prefix only, no slot of the `/` menu, with its description in the three languages
  assert.equal(command.prefixOnly, true, 'it is only for the prefix: no slot of the / menu');
  assert.ok(command.aliases.includes('vars'));
  assert.equal(isSlashCommand(command), false, 'it is not registered as a slash command');
  assert.ok(client.commands.has('variables') && client.commandAliases.get('vars') === 'variables', 'it is loaded, with its word');
  for (const lang of ['en', 'es', 'pt-BR']) for (const key of ['cmd.info.variables.desc', 'cmd.info.variables.opt.query.desc']) assert.notEqual(i18n.t(lang, key), key, `${lang}: ${key}`);

  // ---- the list of flags written in the text
  const ids = new Set();
  for (const entry of flags.SPECIAL_FLAGS) {
    assert.ok(!ids.has(entry.id), `${entry.id} is once`);
    ids.add(entry.id);
    assert.ok(entry.flags.length && entry.flags.every((name) => /^--[a-z][a-z_]*$/.test(name)), `${entry.id}: written with two dashes`);
    assert.ok(['nothing', 'word'].includes(entry.takes));
    const owner = client.commands.get(entry.command);
    assert.ok(owner, `${entry.id}: the command ${entry.command} exists`);
    const subs = (owner.data.toJSON().options ?? []).filter((option) => option.type === 1 || option.type === 2).map((option) => option.name);
    for (const word of entry.path) assert.ok(subs.includes(word), `${entry.id}: ${entry.command} has a part called ${word}`);
    for (const lang of ['en', 'es', 'pt-BR']) assert.notEqual(i18n.t(lang, `variables.flag.${entry.id}`), `variables.flag.${entry.id}`, `${lang}: the text of ${entry.id}`);
    assert.ok(entry.example.startsWith(entry.command) || entry.example.startsWith('autoresponder'), `${entry.id}: the example is a command to copy`);
  }
  assert.deepEqual(flags.flagsNamed('--Colour').map((entry) => entry.id), ['quote.color'], 'a flag is found by any of its names, with or without dashes and in any case');
  assert.deepEqual(flags.flagsNamed('not-strict').map((entry) => entry.id), ['autoresponder.notStrict'], '- and _ are the same');
  assert.deepEqual(flags.flagsFor('pagination', ['delete']).map((entry) => entry.id), ['pagination.message'], 'the flags of a part of a command');
  assert.ok(flags.flagsFor('autoresponder', ['add']).length === 8 && flags.flagsFor('quote').length === 3);

  // ---- nothing is forgotten: every --flag of the code or of the texts is an option of a command or is listed
  const optionNames = new Set();
  const collect = (node) => { for (const option of node.options ?? []) { if (option.type === 1 || option.type === 2) collect(option); else optionNames.add(flags.normalizeName(option.name)); } };
  for (const each of client.commands.values()) if (each.data) collect(each.data.toJSON());
  const listed = new Set(flags.SPECIAL_FLAGS.flatMap((entry) => entry.flags.map(flags.normalizeName)));
  // What is not a flag of a command: words inside an embed code that the reader leaves alone (codeArgs), and the team-only commands.
  const IGNORED = { word: 'an example inside an embed code, which the reader of flags leaves alone (utils/codeArgs.js)', flags: 'a word of a comment about the flags in general (utils/codeArgs.js)', here: 'a team-only command (!leaveguild)' };
  const sources = [
    ...walkFiles(path.join(ROOT, 'src/commands'), '.js'),
    ...['utils/codeArgs.js', 'utils/purgeFilters.js', 'utils/pagination.js', 'utils/commandFlags.ts'].map((file) => path.join(ROOT, 'src', file)),
    ...walkFiles(path.join(ROOT, 'src/i18n/locales/en'), '.js'),
  ];
  const unknown = new Map();
  for (const file of sources) {
    const code = fs.readFileSync(file, 'utf8');
    for (const match of code.matchAll(/(?<![\w-])--([a-z][a-z0-9_-]{1,24})(?![\w-])/gi)) {
      if (code.slice(Math.max(0, match.index - 4), match.index) === 'var(') continue;
      const name = flags.normalizeName(match[1]);
      if (optionNames.has(name) || listed.has(name) || IGNORED[name]) continue;
      unknown.set(name, [...(unknown.get(name) ?? []), path.relative(ROOT, file)]);
    }
  }
  assert.deepEqual([...unknown.entries()].map(([name, files]) => `--${name} (${[...new Set(files)].join(', ')})`), [], 'a --flag that is not an option of any command and is not in utils/commandFlags.ts: add it there, with its texts, or it stays unknown to people');

  // ---- the answers
  const GUILD = '111111111111111111';
  const ask = async (query, lang = 'en') => {
    i18n.setCachedGuildLanguage(GUILD, lang);
    const replies = [];
    const interaction = { client, guild: { id: GUILD }, guildId: GUILD, locale: 'en-US', guildLocale: 'en-US', user: { id: 'u' }, typedPrefix: '!', options: { getString: () => query }, reply: async (payload) => { replies.push(payload); } };
    await command.execute(interaction);
    assert.equal(replies.length, 1, `one answer for "${query}"`);
    assert.equal(replies[0].flags, MessageFlags.IsComponentsV2);
    assert.equal(replies[0].allowedMentions.parse.length, 0, 'it mentions nobody');
    return text(replies[0]);
  };

  let said = await ask('');
  assert.ok(said.includes('Variables of messages') && said.includes('!embed vars') && said.includes('!variables quote') && said.includes('wiki.petto.sbs/resources/scripting/variables'), 'the overview says where each thing is');
  assert.ok((await ask('', 'es')).includes('wiki.petto.sbs/es/resources/scripting/variables') && (await ask('', 'pt-BR')).includes('wiki.petto.sbs/pt-br/resources/scripting/variables'), 'and links the wiki in the language');
  assert.ok((await ask('messages')).includes('!embed vars'), 'the variables of messages');
  said = await ask('flags');
  for (const entry of flags.SPECIAL_FLAGS) assert.ok(said.includes(entry.flags[0]), `the flags list has ${entry.flags[0]}`);
  assert.ok(said.includes('!quote hello @member --color'), 'with examples to copy');
  assert.ok((await ask('flags', 'es')).includes('Opciones que solo se escriben en el texto') && (await ask('flags', 'pt-BR')).includes('Opções que só se escrevem no texto'), 'in the language of the server');

  said = await ask('quote');
  assert.ok(said.includes('!quote') && said.includes('--color') && said.includes('--light') && said.includes('--bold'), 'the flags of quote, written in the text');
  said = await ask('role all');
  assert.ok(said.includes('!role all') && said.includes('`--role`') && said.includes('`--preview`'), 'the options of a part of a command, from its builder, with the one that can be written alone');
  assert.ok(said.includes('role') && /required|obligatoria/.test(said) === true, 'and which are required');
  said = await ask('role');
  assert.ok(said.includes('!variables role add') && said.includes('Ask for one') && said.includes('!variables role all'), 'a command with parts lists them');
  said = await ask('q');
  assert.ok(said.includes('!quote'), 'a word of the command also works');
  said = await ask('role all', 'es');
  assert.ok(said.includes('obligatoria') && !said.includes('Ask for one'), 'in Spanish');
  said = await ask('ban');
  assert.ok(said.includes('!ban'), 'a command with options directly');

  said = await ask('duration');
  assert.ok(said.includes('`--duration`') && /is an option of these commands|Used in \d+ commands/.test(said) && said.includes('--duration'), 'where an option is used');
  said = await ask('--joined-after');
  assert.ok(said.includes('joined_after'), 'an option found with dashes and either - or _');
  said = await ask('--colour');
  assert.ok(said.includes('!quote hello @member --color') && said.includes('Written in the text'), 'a flag of the text is found by its name');
  said = await ask('team');
  assert.ok(typeof said === 'string');

  said = await ask('notacommandatall');
  assert.ok(said.includes('I found no command or option called') && said.includes('!variables'), 'nothing found says how to look');
  said = await ask('rol');
  assert.ok(said.includes('Maybe') && said.includes('!variables role'), 'a few that start the same way');
  said = await ask(`quote ${'x'.repeat(2000)}`);
  assert.ok(said.length < 4000, 'an answer fits in a message');

  // A team-only command is not shown to everybody.
  said = await ask('leaveguild');
  assert.ok(said.includes('I found no command or option called'), 'a team command is not listed');
  console.log('Variables checks passed (the list of flags, nothing forgotten, the overview, a command, its parts, an option, the flags, in three languages).');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
