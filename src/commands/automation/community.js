// /community: what members can send to the staff and the setup of each, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/community`). Each group is an old
// command with all its subcommands (`/community suggestion setup` is `!suggestion setup`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!community suggestion setup` sends what follows to the old command, and `!community` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/community` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: nothing at the level of the command for suggestion, confession, confess, request, review and profile (what the staff does is checked by
// the command itself: Manage Server or the staff roles of the feature), Manage Server for requestconfig and profileconfig. With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none.
const SUBCOMMANDS = [
  { group: 'suggestion', wraps: 'suggestion' },
  { group: 'confession', wraps: 'confession' },
  { name: 'confess', wraps: 'confess' },
  { group: 'request', wraps: 'request' },
  { group: 'requestconfig', wraps: 'requestconfig' },
  { group: 'review', wraps: 'review' },
  { name: 'profile', wraps: 'profile' },
  { group: 'profileconfig', wraps: 'profileconfig' },
];

module.exports = defineUmbrella({
  name: 'community',
  description: 'Members and staff: suggestions, confessions, requests, reviews and profiles, with their setup.',
  subcommands: SUBCOMMANDS,
});
