// /bot: Petto itself, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/bot`). Each group is an old
// command with all its subcommands (`/bot votes show` is `!votes show`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!bot votes show` sends what follows to the old command, and `!bot` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/bot` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: nothing for any of them (`premium` keeps what is for the team to the team by itself). With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none.
const SUBCOMMANDS = [
  { name: 'uptime', wraps: 'uptime' },
  { name: 'version', wraps: 'version' },
  { group: 'votes', wraps: 'votes' },
  { group: 'premium', wraps: 'premium' },
];

module.exports = defineUmbrella({
  name: 'bot',
  description: 'About Petto: how long it has been running, its version, its votes and Premium.',
  subcommands: SUBCOMMANDS,
});
