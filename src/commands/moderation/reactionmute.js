// /reactionmute: Takes away the reactions and external emojis of a member in every channel, or gives them back. A slash command of its own with a whole-word name (the prefix word is `!rmute`; `!reactionmute` works too), registered in each server (the second set of slash
// commands). It has the options and runs the code of `rmute`; a rule of a server for `rmute` (`!disablecommand rmute`, `!restrictcommand rmute`) applies to it as well.
const base = require('./rmute');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  hiddenFromHelp: true,
  legacyRuleNames: ['rmute'],
  // The builder of `rmute` with the name of this command.
  data: Object.assign(Object.create(Object.getPrototypeOf(base.data)), base.data, { name: 'reactionmute' }),
  execute: (interaction, client) => base.execute(interaction, client),
};
