// Makes (and checks) the table of short prefix aliases: src/utils/short-aliases.json, `{ alias: "command subcommand" }`.
//
//   node scripts/gen-short-aliases.js            adds what is missing to the table (never changes or removes a word that works)
//   node scripts/gen-short-aliases.js --check    changes nothing; lists what would be added or is broken, exit 1 when there is a problem
//   node scripts/gen-short-aliases.js --wiki <path to petto-wiki-docs>   also writes the tables of the wiki (setup/short-aliases.mdx, es, pt-br)
//
// The rule, always the same and always in this order of commands (PRIORITY first, then by name, then LAST; the subcommands in the order they are
// declared):
//   1. the stem of the command is the first letter (`i` for image), or the word chosen for it in STEMS (`tk` for ticket), or its shortest
//      alias of 2 or 3 letters (`gw` for giveaway);
//   2. the alias is the stem plus the initial of the subcommand (the initials of each word: `reward add` is `ra`): `is` is image sepia;
//   3. if that word is taken by anything (a command, an alias, a route, a word already in the table), more letters of the subcommand are
//      used (`iro` for image rotate, because `ir` is `!inrole`), up to 5 letters in all;
//   4. if the stem is not the first letter, the first letter is tried too, with the same steps;
//   5. if nothing is free, the subcommand has no short alias. A word is never taken from anything that already has it.
//    A subcommand that already has a route of 3 letters or less written by hand (`!mu` is `!minecraft user`) is left alone.
// A long command with no subcommands (`leaveguild`) gets the first letters of its consonants (`lvg`) when it has no alias of 7 letters or less.
// The table is committed: running this later only adds words for new commands and subcommands, so a word never changes meaning.
process.env.DISCORD_TOKEN ||= 'gen';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://gen:gen@127.0.0.1:1/gen'; // never connected to
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TABLE_FILE = path.join(ROOT, 'src', 'utils', 'short-aliases.json');
const MAX_LENGTH = 5;
const MAX_STEM = 3;
// The commands people type most come first, so they get the shortest words.
const PRIORITY = ['image', 'ticket', 'timer', 'feed', 'giveaway', 'welcome', 'backup', 'automod', 'counter', 'snipe', 'afk', 'remind', 'birthday', 'level', 'starboard', 'suggestion', 'verify'];
// The umbrellas `/server`, `/user`, `/mod`, `/game`, `/me`, `/search`, `/staff`, `/config`, `/protect`, `/greet`, `/auto`, `/message`, `/community`, `/contrib`, `/special` and `/bot` come after every other command, so their words are the ones left free and no word that already
// works changes (their subcommands are the old commands with their own words: `!si`, `!ui`, `!av`).
const LAST = ['server', 'user', 'mod', 'game', 'me', 'search', 'staff', 'config', 'protect', 'greet', 'auto', 'message', 'community', 'contrib', 'special', 'bot'];
// A stem that is not the first letter or a short alias already there: the usual way people shorten the name.
const STEMS = { image: 'i', ticket: 'tk', feed: 'fd', backup: 'bk', counter: 'cn', snipe: 'sn', afk: 'af', remind: 'rm', forum: 'fr' };
// Left out: the actions of /act have their own words (`!hug`), and these are not for members to type.
const SKIPPED_COMMANDS = new Set(['act']);

/** Everything the rule needs to know about the commands, read from the command files. */
function loadCommandInfo() {
  const { findCommandFiles, COMMANDS_DIR } = require('../src/handlers/commandHandler');
  const { DEFAULT_COMMAND_ALIASES, BASE_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');
  const commands = [];
  for (const file of findCommandFiles(COMMANDS_DIR)) {
    const command = require(file);
    if (!command?.data || typeof command.execute !== 'function') continue;
    const json = command.data.toJSON();
    if ((json.type ?? 1) !== 1) continue;
    const category = path.basename(path.dirname(file));
    const subcommands = (json.options ?? []).flatMap((option) => (option.type === 1 ? [option.name] : option.type === 2 ? (option.options ?? []).map((sub) => `${option.name} ${sub.name}`) : []));
    const aliases = [...new Set([...(command.aliases ?? []), ...(DEFAULT_COMMAND_ALIASES[json.name] ?? [])].map((word) => word.toLowerCase()))];
    commands.push({ name: json.name, category, aliases, subcommands, hidden: Boolean(command.hiddenFromHelp || command.slashOnly || command.privateGuildId || category === 'roleplay' || (json.name.endsWith('config') && json.name !== 'config')) });
  }
  // Every word that already means something (the ones written by hand; the table itself is not in here).
  const taken = new Set();
  for (const command of commands) {
    taken.add(command.name);
    for (const alias of command.aliases) taken.add(alias);
  }
  for (const route of BASE_PREFIX_ROUTES) taken.add(route.alias.toLowerCase());
  // What already has a short way to be typed (a route of 3 letters or less written by hand).
  const covered = new Set(BASE_PREFIX_ROUTES.filter((route) => route.alias.length <= 3).map((route) => (route.subcommand ? `${route.command} ${route.subcommand}` : route.command)));
  return { commands, taken, covered };
}

const vowels = /[aeiou]/;
/** The initials of the words of a subcommand and the letters that follow, as the endings to try: `sepia` is s, se, sep, sepi; `reward add` is ra, rad, radd. */
function tails(sub) {
  const words = sub.toLowerCase().split(/[^a-z]+/).filter(Boolean); // letters only: a short alias is 2 to 5 letters (`8ball` is `b`, `ba`...)
  const initials = words.map((word) => word[0]).join('');
  const last = words[words.length - 1];
  const list = [initials];
  for (let n = 2; n <= last.length && n <= 4; n += 1) list.push(initials + last.slice(1, n));
  return [...new Set(list)];
}

function stemsOf(command) {
  const first = command.name[0];
  const own = command.aliases.filter((alias) => /^[a-z]{2,3}$/.test(alias)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  const main = STEMS[command.name] ?? own ?? first;
  return [...new Set([main, first])].filter((stem) => stem.length <= MAX_STEM);
}

/** The words the rule would add to `table` (an object alias -> target): `{ added, skipped }`; `table` itself is not changed. */
function generate({ commands, taken, table, covered = new Set() }) {
  const used = new Set([...taken, ...Object.keys(table)]);
  const targets = new Set(Object.values(table));
  const added = {};
  const skipped = [];
  const free = (word) => word.length >= 2 && word.length <= MAX_LENGTH && !used.has(word);
  const claim = (word, target) => { used.add(word); added[word] = target; };
  const ordered = [...commands].filter((command) => !command.hidden && !SKIPPED_COMMANDS.has(command.name))
    .sort((a, b) => {
      const rank = (name) => (PRIORITY.includes(name) ? PRIORITY.indexOf(name) : LAST.includes(name) ? 2e9 + LAST.indexOf(name) : 1e9);
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
    });
  for (const command of ordered) {
    for (const sub of command.subcommands) {
      const target = `${command.name} ${sub}`;
      if (targets.has(target) || covered.has(target)) continue;
      let found = null;
      for (const stem of stemsOf(command)) {
        for (const tail of tails(sub)) {
          if (free(stem + tail)) { found = stem + tail; break; }
        }
        if (found) break;
      }
      if (found) claim(found, target); else skipped.push(target);
    }
    // A long command with nothing to shorten it.
    if (!command.subcommands.length && command.name.length >= 8 && !command.aliases.some((alias) => alias.length <= 7) && !Object.values(table).includes(command.name)) {
      const skeleton = command.name[0] + command.name.slice(1).split('').filter((letter) => !vowels.test(letter)).join('');
      let found = null;
      for (let n = 3; n <= 4 && !found; n += 1) if (skeleton.length >= n && free(skeleton.slice(0, n))) found = skeleton.slice(0, n);
      if (found) claim(found, command.name); else skipped.push(command.name);
    }
  }
  return { added, skipped };
}

/**
 * What is wrong with a table: a word that is the name, alias or route of something else, a target that does not exist (any more), two
 * words for one target, an odd word. Answers a list of sentences (empty when the table is fine).
 */
function problems({ commands, taken, table }) {
  const found = [];
  const byName = new Map(commands.map((command) => [command.name, command]));
  const seen = new Map();
  for (const [alias, target] of Object.entries(table)) {
    if (!/^[a-z]{2,5}$/.test(alias)) found.push(`${alias}: a short alias is 2 to 5 lowercase letters`);
    if (taken.has(alias)) found.push(`${alias} (${target}) is already the name, an alias or a route of another command: a command must not take it`);
    const [name, ...rest] = target.split(' ');
    const command = byName.get(name);
    if (!command) found.push(`${alias}: the command ${name} does not exist (any more)`);
    else if (rest.length && !command.subcommands.includes(rest.join(' '))) found.push(`${alias}: ${name} has no subcommand ${rest.join(' ')} (any more)`);
    else if (!rest.length && command.subcommands.length) found.push(`${alias}: ${name} has subcommands, so its short aliases name one`);
    if (seen.has(target)) found.push(`${target} has two short aliases: ${seen.get(target)} and ${alias}`);
    seen.set(target, alias);
  }
  return found;
}

function sortedTable(table) {
  return Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
}

const readTable = () => JSON.parse(fs.readFileSync(TABLE_FILE, 'utf8'));
const writeTable = (table) => fs.writeFileSync(TABLE_FILE, `${JSON.stringify(sortedTable(table), null, 1)}\n`);

module.exports = { generate, problems, loadCommandInfo, readTable, sortedTable, TABLE_FILE, PRIORITY, MAX_LENGTH };

if (require.main === module) {
  const args = process.argv.slice(2);
  const info = loadCommandInfo();
  const table = readTable();
  const wrong = problems({ ...info, table });
  const { added, skipped } = generate({ ...info, table: Object.fromEntries(Object.entries(table).filter(([alias]) => !wrong.some((line) => line.startsWith(`${alias}:`) || line.startsWith(`${alias} `)))) });
  if (args.includes('--check')) {
    for (const line of wrong) console.log(`problem: ${line}`);
    for (const [alias, target] of Object.entries(added)) console.log(`missing: ${alias} -> ${target}`);
    process.exit(wrong.length ? 1 : 0);
  }
  // Words that point to something gone are dropped; everything else stays exactly as it was.
  const kept = Object.fromEntries(Object.entries(table).filter(([alias]) => !wrong.some((line) => line.startsWith(`${alias}:`))));
  const next = { ...kept, ...added };
  writeTable(next);
  console.log(`short aliases: ${Object.keys(next).length} (${Object.keys(added).length} added, ${Object.keys(table).length - Object.keys(kept).length} dropped, ${skipped.length} subcommands without one)`);
  if (args.includes('--wiki')) require('./short-aliases-docs').writeWiki(args[args.indexOf('--wiki') + 1], next, info);
}
