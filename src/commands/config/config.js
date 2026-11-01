// /config: Petto's settings for this server, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/config`). Each group is an old
// command with all its subcommands (`/config prefix set` is `!prefix set`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!config prefix set` sends what follows to the old command, and `!config` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/config` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: Manage Server for every group (prefix, language, alias, moderation, restrictcommand, disablecommand, sanctionmessage, appeals, backup,
// statsconfig), nothing for `recommended`. With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none.
const SUBCOMMANDS = [
  { group: 'prefix', wraps: 'prefix' },
  { name: 'language', wraps: 'language' },
  { group: 'alias', wraps: 'alias' },
  { group: 'moderation', wraps: 'moderation' },
  { group: 'restrictcommand', wraps: 'restrictcommand' },
  { group: 'disablecommand', wraps: 'disablecommand' },
  { group: 'sanctionmessage', wraps: 'sanctionmessage' },
  { name: 'appeals', wraps: 'appeals' },
  { group: 'backup', wraps: 'backup' },
  { group: 'statsconfig', wraps: 'statsconfig' },
  { name: 'recommended', wraps: 'cmdconfig' },
];

module.exports = defineUmbrella({
  name: 'config',
  description: "Petto's settings: prefix, language, aliases, moderation roles, backups and more.",
  subcommands: SUBCOMMANDS,
});
