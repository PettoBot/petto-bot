// /greet: what happens when members join, leave or boost, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/greet`). Each group is an old
// command with all its subcommands (`/greet welcome setup` is `!welcome setup`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!greet welcome setup` sends what follows to the old command, and `!greet` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/greet` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: Manage Server for welcome, leave, boost, dmonjoin and poj; Manage Roles for joinrole and stickyroles. With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none.
const SUBCOMMANDS = [
  { group: 'welcome', wraps: 'welcome' },
  { group: 'leave', wraps: 'leave' },
  { group: 'boost', wraps: 'boost' },
  { group: 'dmonjoin', wraps: 'dmonjoin' },
  { group: 'poj', wraps: 'poj' },
  { group: 'joinrole', wraps: 'joinrole' },
  { group: 'stickyroles', wraps: 'stickyroles' },
];

module.exports = defineUmbrella({
  name: 'greet',
  description: 'Members who join, leave or boost: welcome and goodbye messages, DM, ping on join, join roles.',
  subcommands: SUBCOMMANDS,
});
