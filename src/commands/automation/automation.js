// /automation: Petto on its own, as groups of one command (a tidier `/` list: they are found by typing `/automation`). Each group is an old
// command with all its subcommands (`/automation timer add` is `!timer add`); they take the same options and run the same code (utils/umbrella.js).
// The old commands keep working as they were, with the prefix and with their words, routes and short aliases: `!automation timer add` sends what
// follows to the old command, and `!automation` alone lists the groups. This command was called `/auto`: the word still works with the prefix.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/automation` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it wraps asks.
const { defineUmbrella } = require('../../utils/umbrella');

const SUBCOMMANDS = [
  { group: 'autothread', wraps: 'autothread' },
  { group: 'bumpreminder', wraps: 'bumpreminder' },
  { group: 'reaction', wraps: 'reaction' },
  { group: 'reactionrole', wraps: 'reactionrole' },
  { group: 'stickymessage', wraps: 'stickymessage' },
  { group: 'timer', wraps: 'timer' },
];

module.exports = defineUmbrella({
  name: 'automation',
  description: 'Petto on its own: threads, reactions, sticky messages, timers and bumps.',
  subcommands: SUBCOMMANDS,
  aliases: ['auto'],
  legacyRuleNames: ['auto'],
});
