// !specialchannels: the special channels as groups of one command each (`!specialchannels counting setup` is `!counting setup`). Not a slash command
// any more: `/counting`, `/counter`, `/imgonly` and `/urlonly` are commands of their own in the `/` list. It stays for the prefix (and its short
// words, `!scs`), and works as it did. This command was called `/special`, and its groups `imgonly` and `urlonly`: those words still work with the prefix.
//
// PERMISSIONS: each subcommand asks, when it runs, for what the command it wraps asks.
const { defineUmbrella } = require('../../utils/umbrella');

const SUBCOMMANDS = [
  { group: 'counting', wraps: 'counting' },
  { group: 'counter', wraps: 'counter' },
  { group: 'imageonly', wraps: 'imageonly' },
  { group: 'linkonly', wraps: 'linkonly' },
];

module.exports = Object.assign(defineUmbrella({
  name: 'specialchannels',
  description: 'Special channels: counting, live counters, only pictures and only links.',
  subcommands: SUBCOMMANDS,
  aliases: ['special'],
  legacyRuleNames: ['special'],
}), { prefixOnly: true });
