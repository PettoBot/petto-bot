// /specialchannels: channels with a rule of their own, as groups of one command (a tidier `/` list: they are found by typing `/specialchannels`).
// Each group is an old command with all its subcommands (`/specialchannels counting setup` is `!counting setup`); they take the same options and run
// the same code (utils/umbrella.js). The old commands keep working as they were, with the prefix. This command was called `/special`, and its
// groups `imgonly` and `urlonly`: those words still work with the prefix.
//
// PERMISSIONS: `/specialchannels` itself is open and each subcommand asks, when it runs, for what the command it wraps asks.
const { defineUmbrella } = require('../../utils/umbrella');

const SUBCOMMANDS = [
  { group: 'counting', wraps: 'counting' },
  { group: 'counter', wraps: 'counter' },
  { group: 'imageonly', wraps: 'imgonly' },
  { group: 'linkonly', wraps: 'urlonly' },
];

module.exports = defineUmbrella({
  name: 'specialchannels',
  description: 'Special channels: counting, live counters, only pictures and only links.',
  subcommands: SUBCOMMANDS,
  aliases: ['special'],
  legacyRuleNames: ['special'],
});
