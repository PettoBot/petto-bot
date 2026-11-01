// /search: lookups of information from outside Discord as subcommands of one command (a tidier `/` list: they are found by typing
// `/search`: weather, time, currency, maths, colors...). Each one runs the code of the command it wraps with its options (utils/umbrella.js): `/search anilist` is `!anilist anime`,
// `/search youtube` is `!youtube video`. What a subcommand leaves out (`!anilist manga`, `!tmdb tv`, `!github issues`...) stays in the old
// command, which keeps working as it was with the prefix. `!search` alone lists the subcommands, and the old words are accepted (`!search yt`).
//
// PERMISSIONS: none of what it wraps asks for a permission, so `/search` is open; the umbrella asks for the permission of the wrapped
// command anyway before running it (utils/umbrella.js), so a command that gets one later is protected here too.
const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, ruleKeysOf, prefixOptionsOf, wrappedExecutor } = require('../../utils/umbrella');

const FOLDERS = { wiki: 'utility', weather: 'utility', time: 'utility', calc: 'utility', color: 'info' };
const load = (name) => require(`../${FOLDERS[name] ?? 'integrations'}/${name}`);

const SUBCOMMANDS = [
  { name: 'anilist', wraps: 'anilist', sub: 'anime' },
  { name: 'tmdb', wraps: 'tmdb', sub: 'movie' },
  { name: 'itunes', wraps: 'itunes', sub: 'song' },
  { name: 'deezer', wraps: 'deezer', sub: 'track' },
  { name: 'lastfm', wraps: 'lastfm', sub: 'now' },
  { name: 'youtube', wraps: 'youtube', sub: 'video' },
  { name: 'twitch', wraps: 'twitch', sub: 'channel' },
  { name: 'wikipedia', wraps: 'wikipedia' },
  { name: 'wiki', wraps: 'wiki' },
  { name: 'weather', wraps: 'weather' },
  { name: 'time', wraps: 'time' },
  { name: 'currency', wraps: 'currency' },
  { name: 'crypto', wraps: 'crypto' },
  { name: 'compute', wraps: 'calc' },
  { name: 'color', wraps: 'color' },
  { name: 'github', wraps: 'github', sub: 'repo' },
  { name: 'package', wraps: 'package', sub: 'npm' },
];

// The words of the old commands, read as the subcommand they stand for (`!search yt`, `!search gh octocat/hello-world`).
const WORDS = {
  anilist: ['ani'], itunes: ['apple'], deezer: ['dz'], lastfm: ['lfm'], youtube: ['yt'], wikipedia: ['wp'], wiki: ['wk'], weather: ['clima', 'meteo'],
  time: ['tz', 'clock'], currency: ['cur', 'convert'], crypto: ['coin'], compute: ['c', 'calc', 'calculate', 'math'], color: ['clr', 'hex'], github: ['gh'], package: ['pkg'],
};
const SUBCOMMAND_WORDS = Object.fromEntries(Object.entries(WORDS).flatMap(([name, words]) => words.map((word) => [word, name])));
const { greedy } = prefixOptionsOf(SUBCOMMANDS, load);
const executor = wrappedExecutor(load, SUBCOMMANDS);

module.exports = {
  // Also registered as a slash command; the prefix works too.
  registerSlash: true,
  // `!search` alone lists the subcommands instead of saying something is wrong.
  listSubcommandsWhenEmpty: true,
  prefixSubcommandAliases: SUBCOMMAND_WORDS,
  // The option that takes every word left, as it does for the old command.
  prefixGreedyStringOptions: greedy,
  // The rules of a server name the command that is wrapped (`!disablecommand weather` also turns off `/search weather`); `search` turns off all of it.
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  permissionForSubcommand: executor.permissionForSubcommand,
  data: addSubcommands(
    new SlashCommandBuilder().setName('search').setDMPermission(false).setDescription('Look things up: anime, movies, music, videos, wiki, weather, time, currency, GitHub and more.'),
    SUBCOMMANDS,
    load,
  ),

  // The subcommands and what each wraps (read by the tests and by scripts/i18n-commands.js for the translations).
  subcommands: SUBCOMMANDS,
  execute: executor.execute,
};
