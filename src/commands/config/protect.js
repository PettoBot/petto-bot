// /protect: the server protection that is not a command of its own, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/protect`). Each group is an old
// command with all its subcommands (`/protect honeypot add` is `!honeypot add`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!protect honeypot add` sends what follows to the old command, and `!protect` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/protect` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: Administrator for `honeypot`, Manage Server for `verify` and `security`. With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none.
const SUBCOMMANDS = [
  { group: 'honeypot', wraps: 'honeypot' },
  { group: 'verify', wraps: 'verify' },
  { group: 'security', wraps: 'security' },
];

module.exports = defineUmbrella({
  name: 'protect',
  description: 'Server protection: honeypot bait channels, the join verification gate and security scans.',
  subcommands: SUBCOMMANDS,
});
