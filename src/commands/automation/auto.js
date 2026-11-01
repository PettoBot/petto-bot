// /auto: what Petto does by itself in the channels, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/auto`). Each group is an old
// command with all its subcommands (`/auto timer add` is `!timer add`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!auto timer add` sends what follows to the old command, and `!auto` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/auto` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: Manage Server for bumpreminder, reaction and timer; Manage Channels for autothread; Manage Roles for reactionrole; Manage Messages
// for stickymessage. With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none.
const SUBCOMMANDS = [
  { group: 'autothread', wraps: 'autothread' },
  { group: 'bumpreminder', wraps: 'bumpreminder' },
  { group: 'reaction', wraps: 'reaction' },
  { group: 'reactionrole', wraps: 'reactionrole' },
  { group: 'stickymessage', wraps: 'stickymessage' },
  { group: 'timer', wraps: 'timer' },
];

module.exports = defineUmbrella({
  name: 'auto',
  description: 'Petto on its own: auto threads, reactions, reaction roles, sticky messages, timers and bumps.',
  subcommands: SUBCOMMANDS,
});
