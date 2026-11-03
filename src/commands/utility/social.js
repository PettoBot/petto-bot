// /social: what members share with each other, as groups of one command (a tidier `/` list: they are found by typing `/social`). Each group is an old
// command with all its subcommands (`/social birthday upcoming` is `!birthday upcoming`, `/social reputation give` is `!rep give`); they take the same
// options and run the same code (utils/umbrella.js). The old commands keep working as they were, with the prefix and with their words, routes and short
// aliases. `/me` keeps the ones that are only yours (`/me birthday`, `/me reputation`).
//
// PERMISSIONS: `/social` itself is open and each subcommand asks, when it runs, for what the command it wraps asks (the settings of birthdays and
// the reset of reputation are checked inside the old commands, for the slash command and the prefix alike).
const { defineUmbrella } = require('../../utils/umbrella');

const SUBCOMMANDS = [
  { group: 'birthday', wraps: 'birthday' },
  { group: 'reputation', wraps: 'rep' },
];

module.exports = defineUmbrella({
  name: 'social',
  description: 'Birthdays and reputation: set yours, see who is next, give reputation, and the setup of each.',
  subcommands: SUBCOMMANDS,
});
