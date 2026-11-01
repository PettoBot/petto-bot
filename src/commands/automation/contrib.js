// /contrib: partnerships and uploads, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/contrib`). Each group is an old
// command with all its subcommands (`/contrib partner stats` is `!partner stats`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!contrib partner stats` sends what follows to the old command, and `!contrib` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/contrib` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: nothing for `partner` and `uploads` (their numbers and rankings are for everybody), Manage Server for `partnerconfig` and `uploadconfig`. With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none.
const SUBCOMMANDS = [
  { group: 'partner', wraps: 'partner' },
  { group: 'partnerconfig', wraps: 'partnerconfig' },
  { group: 'uploads', wraps: 'uploads' },
  { group: 'uploadconfig', wraps: 'uploadconfig' },
];

module.exports = defineUmbrella({
  name: 'contrib',
  description: 'Partnerships and uploads: your numbers, the ranking and the setup of each.',
  subcommands: SUBCOMMANDS,
});
