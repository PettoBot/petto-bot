// Checks the short ways to type the commands (`!mu` for `!minecraft user`, `!ub` for `!unban`...): none of them is the name or the alias of another
// command, none is written twice, and every route points to a command and a subcommand that exist.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_COMMAND_ALIASES, DEFAULT_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');

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

console.log('check-short-aliases: ok');
