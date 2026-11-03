// /contributions: partnerships and uploads, as groups of one command (a tidier `/` list: they are found by typing `/contributions`). Each group is an old
// command with all its subcommands (`/contributions partner stats` is `!partner stats`); they take the same options and run the same code
// (utils/umbrella.js). The old commands keep working as they were, with the prefix. This command was called `/contrib`: the word still works with the prefix.
//
// PERMISSIONS: `/contributions` itself is open and each subcommand asks, when it runs, for what the command it wraps asks (the setup groups ask for Manage Server).
const { defineUmbrella } = require('../../utils/umbrella');

const SUBCOMMANDS = [
  { group: 'partner', wraps: 'partner' },
  { group: 'partnerconfig', wraps: 'partnerconfig' },
  { group: 'uploads', wraps: 'uploads' },
  { group: 'uploadconfig', wraps: 'uploadconfig' },
];

module.exports = defineUmbrella({
  name: 'contributions',
  description: 'Partnerships and uploads: your numbers, the ranking and the setup of each.',
  subcommands: SUBCOMMANDS,
  aliases: ['contrib'],
  legacyRuleNames: ['contrib'],
});
