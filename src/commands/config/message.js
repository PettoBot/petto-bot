// /message: the messages Petto sends, as groups and subcommands of one command (a tidier `/` list: they are found by typing `/message`). Each group is an old
// command with all its subcommands (`/message panel create` is `!panel create`), each subcommand one that has none; they take the same options and run the
// same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short aliases:
// `!message panel create` sends what follows to the old command, and `!message` alone lists the groups.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/message` itself is open (null:
// everybody sees it, and a server can limit it in Settings > Integrations) and each subcommand asks, when it runs, for what the command it
// wraps asks: Manage Messages for `send`, `editembed` and `pagination`; Manage Server for `sender`, `panel` and `responder`; Manage Webhooks for
// `webhook`. With the prefix the old command does the same check, with its own rules. What the wrapped command checks by itself
// (the permission of the bot, who may change what) still runs after, untouched.
const { defineUmbrella } = require('../../utils/umbrella');

// `group`: a command with subcommands, all of them; `name`: a command with none.
const SUBCOMMANDS = [
  { name: 'send', wraps: 'send' },
  { name: 'editembed', wraps: 'editembed' },
  { group: 'sender', wraps: 'sender' },
  { group: 'webhook', wraps: 'webhook' },
  { group: 'panel', wraps: 'panel' },
  { group: 'responder', wraps: 'responder' },
  { group: 'pagination', wraps: 'pagination' },
];

module.exports = defineUmbrella({
  name: 'message',
  description: 'Messages Petto sends: send and edit, sender names, webhooks, panels, responders and pages.',
  subcommands: SUBCOMMANDS,
});
