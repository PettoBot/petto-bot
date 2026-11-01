// /me: what is yours, as subcommands of one command (a tidier `/` list: they are found by typing `/me`). Each one runs the code of the
// command it wraps with its options (utils/umbrella.js): `/me birthday` is `!birthday set`, `/me prefix-set` is `!myprefix set`. What a
// subcommand leaves out (`!birthday upcoming`...) stays in the old command, which keeps working as it was with the
// prefix. `!me` alone lists the subcommands.
//
// PERMISSIONS: everything here is for the member who types it, so `/me` is open; the umbrella asks for the permission of the wrapped command
// anyway before running it (utils/umbrella.js), so a command that gets one later is protected here too.
//
// The booster role is not here: it is its own command, `/boosterrole`.
//
// `me` is also an everyday word (Spanish `me`), so a word prefix such as `petto` never starts it (`petto me ayudas`): `!me` and `/me` do.
const { SlashCommandBuilder } = require('discord.js');
const { addSubcommands, ruleKeysOf, prefixOptionsOf, wrappedExecutor } = require('../../utils/umbrella');

const FOLDERS = { lastfm: 'integrations', spotify: 'info' };
const load = (name) => require(`../${FOLDERS[name] ?? 'utility'}/${name}`);

const SUBCOMMANDS = [
  { name: 'birthday', wraps: 'birthday', sub: 'set' },
  { name: 'birthday-remove', wraps: 'birthday', sub: 'remove' },
  { name: 'birthday-view', wraps: 'birthday', sub: 'view' },
  { name: 'rep', wraps: 'rep', sub: 'view' },
  { name: 'rep-give', wraps: 'rep', sub: 'give' },
  { name: 'prefix', wraps: 'myprefix', sub: 'show' },
  { name: 'prefix-set', wraps: 'myprefix', sub: 'set' },
  { name: 'prefix-reset', wraps: 'myprefix', sub: 'reset' },
  { name: 'names', wraps: 'profilehistory', sub: 'names' },
  { name: 'nicknames', wraps: 'profilehistory', sub: 'nicknames' },
  { name: 'history-clear', wraps: 'profilehistory', sub: 'clear' },
  { name: 'history-record', wraps: 'profilehistory', sub: 'record' },
  { name: 'ranking', wraps: 'globalranking', sub: 'status' },
  { name: 'ranking-on', wraps: 'globalranking', sub: 'on' },
  { name: 'ranking-off', wraps: 'globalranking', sub: 'off' },
  { name: 'lastfm-link', wraps: 'lastfm', sub: 'link' },
  { name: 'lastfm-unlink', wraps: 'lastfm', sub: 'unlink' },
  { name: 'spotify', wraps: 'spotify', sub: 'view' },
];

// The words of the old commands, read as the subcommand they stand for (`!me bday 25 12`, `!me phist`).
const WORDS = {
  birthday: ['bday', 'bd'], rep: ['reputation'], prefix: ['myprefix', 'userprefix', 'selfprefix', 'upfx'], names: ['phist'], ranking: ['globalranking', 'globalrank', 'publicranking'],
  spotify: ['sp'],
};
const SUBCOMMAND_WORDS = Object.fromEntries(Object.entries(WORDS).flatMap(([name, words]) => words.map((word) => [word, name])));
const { greedy } = prefixOptionsOf(SUBCOMMANDS, load);
const executor = wrappedExecutor(load, SUBCOMMANDS);

module.exports = {
  // Also registered as a slash command; the prefix works too.
  registerSlash: true,
  // `!me` alone lists the subcommands instead of saying something is wrong.
  listSubcommandsWhenEmpty: true,
  prefixSubcommandAliases: SUBCOMMAND_WORDS,
  // The option that takes every word left, as it does for the old command.
  prefixGreedyStringOptions: greedy,
  // The rules of a server name the command that is wrapped (`!disablecommand birthday` also turns off `/me birthday`); `me` turns off all of it.
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  permissionForSubcommand: executor.permissionForSubcommand,
  data: addSubcommands(
    new SlashCommandBuilder().setName('me').setDMPermission(false).setDescription('Your own things: birthday, reputation, prefix, name history, ranking, Last.fm and Spotify.'),
    SUBCOMMANDS,
    load,
  ),

  // The subcommands and what each wraps (read by the tests and by scripts/i18n-commands.js for the translations).
  subcommands: SUBCOMMANDS,
  execute: executor.execute,
};
