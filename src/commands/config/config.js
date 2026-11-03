// /config: Petto's settings for this server, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/config`). Each group is an old
// command with all its subcommands (`/config alias add` is `!alias add`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!config alias add` sends what follows to the old command, and `!config` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/config` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: Manage Server for every group (language, alias, moderationroles, commandroles, disabledcommands, sanctionmessage, appeals, backup,
// statistics), nothing for `recommended`. With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none. The names of the groups say what they hold (the old
// command names still work with the prefix: `!config restrictcommand add` is `!restrictcommand add`).
const SUBCOMMANDS = [
  { name: 'language', wraps: 'language' },
  { name: 'recommended', wraps: 'cmdconfig' },
  { group: 'alias', wraps: 'alias' },
  { group: 'moderationroles', wraps: 'moderation' },
  { group: 'commandroles', wraps: 'restrictcommand' },
  { group: 'disabledcommands', wraps: 'disablecommand' },
  { group: 'sanctionmessage', wraps: 'sanctionmessage' },
  { name: 'appeals', wraps: 'appeals' },
  { group: 'backup', wraps: 'backup' },
  { group: 'statistics', wraps: 'statsconfig' },
];

module.exports = defineUmbrella({
  name: 'config',
  description: "Petto's settings: language, aliases, who may use what, sanction messages, appeals, backups.",
  subcommands: SUBCOMMANDS,
  // The prefix of the server has its own command now (`/prefix`); `!config prefix set` still reaches it.
  legacyRoutes: { prefix: { command: 'prefix', args: [] } },
});
