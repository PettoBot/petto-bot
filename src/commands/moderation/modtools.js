// /modtools: the rest of the moderation commands that `/mod` and `/staff` do not hold, as groups of one command (a tidier `/` list: they are found by
// typing `/modtools`). Each group is an old command with all its subcommands (`/modtools case view` is `!case view`, `/modtools note add` is `!note add`);
// they take the same options and run the same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words,
// routes and short aliases: `!modtools case view` sends what follows to the old command, and `!modtools` alone lists the groups.
//
// `/mod` keeps the everyday actions (ban, kick, mute, warn...); here are the cases, the notes, the jail, the list of mutes, the forced nicknames, the
// threads, the deleted-message viewer and the lockdown, so every prefix moderation command has a slash entry.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/modtools` itself is open (a server can limit it
// in Settings > Integrations) and each subcommand asks, when it runs, for what the command it wraps asks, or for the role chosen with `!moderation`.
const { defineUmbrella } = require('../../utils/umbrella');

const lockdown = (name, sub, subGroup) => ({ name, wraps: 'lockdown', sub, ...(subGroup ? { subGroup } : {}) });

const SUBCOMMANDS = [
  { group: 'case', wraps: 'case' },
  { group: 'note', wraps: 'note' },
  { group: 'jail', wraps: 'jail' },
  { group: 'mute', wraps: 'mute' },
  { group: 'nickname', wraps: 'nickname' },
  { group: 'thread', wraps: 'thread' },
  { group: 'snipe', wraps: 'snipe' },
  {
    group: 'lockdown',
    description: 'Lock the whole server in an emergency, and choose the channels it leaves alone.',
    leaves: [
      lockdown('start', 'start'),
      lockdown('end', 'end'),
      lockdown('status', 'status'),
      lockdown('config', 'config'),
      lockdown('add-channel', 'add', 'channel'),
      lockdown('remove-channel', 'remove', 'channel'),
    ],
  },
];

module.exports = defineUmbrella({
  name: 'modtools',
  description: 'More moderation: cases, notes, jail, mutes, nicknames, threads, deleted messages and lockdown.',
  subcommands: SUBCOMMANDS,
});
