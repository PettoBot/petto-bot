// Checks the short ways to type the commands (`!mu` for `!minecraft user`, `!ub` for `!unban`...): none of them is the name or the alias of another
// command, none is written twice, and every route points to a command and a subcommand that exist.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_COMMAND_ALIASES, DEFAULT_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');
const { SHORT_ALIAS_TABLE } = require('../src/utils/shortAliases');
const { isCommonWord } = require('../src/utils/commonWords');

const commands = new Map(); // name -> { data, aliases }
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.js')) {
      const command = require(file);
      if (command?.data) commands.set(command.data.name, { data: command.data.toJSON(), aliases: command.aliases ?? [] });
    }
  }
})(path.join(__dirname, '..', 'src', 'commands'));

// Every word that already means something: names and aliases written in the command files.
const owners = new Map();
for (const [name, { aliases }] of commands) {
  owners.set(name, name);
  for (const alias of aliases) owners.set(alias, name);
}

// A route points to a command and one of its subcommands.
for (const route of DEFAULT_PREFIX_ROUTES) {
  const command = commands.get(route.command);
  assert.ok(command, `route ${route.alias}: the command ${route.command} does not exist`);
  // A subcommand of a group is written `group subcommand` (`love hug` of /act).
  const subcommands = (command.data.options ?? []).flatMap((option) => (option.type === 1 ? [option.name] : option.type === 2 ? (option.options ?? []).map((sub) => `${option.name} ${sub.name}`) : []));
  if (route.subcommand) assert.ok(subcommands.includes(route.subcommand), `route ${route.alias}: ${route.command} has no subcommand ${route.subcommand}`);
}

// The routes of the lookups and the default aliases of the moderation, added with the short ways to type them.
const SHORT = {
  mu: 'minecraft', ms: 'minecraft', msk: 'minecraft', mh: 'minecraft',
  gu: 'github', gr: 'github', grl: 'github', gc: 'github', gi: 'github', gp: 'github', gl: 'github',
  ru: 'roblox', rav: 'roblox', rg: 'roblox', stp: 'steam', stg: 'steam', tc: 'twitch', tcl: 'twitch', tt: 'twitch',
  yv: 'youtube', yc: 'youtube', yl: 'youtube', ys: 'youtube',
  lr: 'lastfm', lta: 'lastfm', ltt: 'lastfm', ltl: 'lastfm', lwk: 'lastfm', lcp: 'lastfm', la: 'lastfm',
  dzt: 'deezer', dza: 'deezer', dzl: 'deezer', its: 'itunes', ita: 'itunes', itp: 'itunes',
  ami: 'anilist', mga: 'anilist', achar: 'anilist', cch: 'chess', lic: 'chess',
};
for (const [alias, command] of Object.entries(SHORT)) {
  const routes = DEFAULT_PREFIX_ROUTES.filter((route) => route.alias === alias);
  assert.equal(routes.length, 1, `${alias} must be one route`);
  assert.equal(routes[0].command, command);
  assert.equal(owners.has(alias), false, `${alias} is already the name or an alias of ${owners.get(alias)}`);
}
const quick = { ub: 'unban', um: 'unmute', uj: 'unjail', ld: 'lockdown', cs: 'case' };
for (const [alias, command] of Object.entries(quick)) {
  assert.deepEqual(DEFAULT_COMMAND_ALIASES[command]?.includes(alias), true, `${alias} must be a default alias of ${command}`);
  assert.equal(owners.has(alias), false, `${alias} is already the name or an alias of ${owners.get(alias)}`);
}

// No word is a default alias twice, a route twice, or a route and an alias at once.
const seen = new Map();
const claim = (word, what) => { assert.equal(seen.has(word), false, `${word} is ${seen.get(word)} and ${what}`); seen.set(word, what); };
for (const [command, aliases] of Object.entries(DEFAULT_COMMAND_ALIASES)) for (const alias of aliases) claim(alias, `a default alias of ${command}`);
for (const route of DEFAULT_PREFIX_ROUTES) claim(route.alias, `a route to ${route.command}`);

// The short words of the subcommands (`!is` is `!image sepia`, `!tko` is `!ticket open`): see src/utils/shortAliases.js.
const shortRoutes = DEFAULT_PREFIX_ROUTES.filter((route) => route.short);
assert.equal(shortRoutes.length, SHORT_ALIAS_TABLE.length, 'every row of the table is a route');
assert.ok(shortRoutes.length >= 100, 'a good number of short aliases');
const uniqueShort = new Set(shortRoutes.map((route) => route.alias));
assert.equal(uniqueShort.size, shortRoutes.length, 'no short alias is written twice');
for (const route of shortRoutes) {
  assert.match(route.alias, /^[a-z]{2,5}$/, `${route.alias} is two to five letters`);
  assert.equal(route.args.join(' '), route.subcommand, `${route.alias} sends ${route.subcommand} to ${route.command}`);
  assert.equal(owners.has(route.alias), false, `${route.alias} is already the name or an alias of ${owners.get(route.alias)}`);
  assert.equal(commands.has(route.alias), false, `${route.alias} is not a command`);
  assert.equal(DEFAULT_PREFIX_ROUTES.filter((other) => other.alias === route.alias).length, 1, `${route.alias} is one route`);
  assert.equal(Object.values(DEFAULT_COMMAND_ALIASES).some((list) => list.includes(route.alias)), false, `${route.alias} is not a default alias`);
}
// The common words stay on the list of the words that never follow a word prefix: they only ever work with a symbol (`!is`).
for (const alias of ['is', 'if', 'im']) assert.ok(isCommonWord(alias) && shortRoutes.some((route) => route.alias === alias), `${alias} is a short alias and a common word`);
// Every effect of /image has its short word, and so does a good part of the commands people use most.
const byCommand = (name) => shortRoutes.filter((route) => route.command === name).map((route) => route.subcommand);
assert.deepEqual([...new Set(byCommand('image'))].sort(), (commands.get('image').data.options ?? []).map((option) => option.name).sort(), 'every /image effect has a short alias');
for (const name of ['ticket', 'timer', 'feed', 'giveaway', 'welcome', 'backup', 'automod', 'counter', 'snipe', 'afk', 'remind', 'birthday', 'level', 'starboard', 'suggestion', 'verify']) {
  assert.ok(byCommand(name).length >= 2, `${name} has short aliases`);
}
// A route is for the prefix only: no short alias is a slash command or the name of an option.
const slash = require('../src/handlers/commandHandler').collectCommandData().map((json) => json.name);
for (const route of shortRoutes) assert.equal(slash.includes(route.alias), false, `${route.alias} is not a slash command`);

console.log('check-short-aliases: ok');
