// /special: the special channels, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/special`). Each group is an old
// command with all its subcommands (`/special counting setup` is `!counting setup`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!special counting setup` sends what follows to the old command, and `!special` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/special` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: Manage Channels for `counter`; nothing at the level of the command for counting, imgonly and urlonly (they check Manage Server by
// themselves). With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none.
const SUBCOMMANDS = [
  { group: 'counting', wraps: 'counting' },
  { group: 'counter', wraps: 'counter' },
  { group: 'imgonly', wraps: 'imgonly' },
  { group: 'urlonly', wraps: 'urlonly' },
];

module.exports = defineUmbrella({
  name: 'special',
  description: 'Special channels: counting, live counters, only pictures and only links.',
  subcommands: SUBCOMMANDS,
});
