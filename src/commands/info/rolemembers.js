// /rolemembers: Lists the members that have a role. A slash command of its own with a whole-word name (the prefix word is `!inrole`; `!rolemembers` works too), registered in each server (the second set of slash
// commands). It has the options and runs the code of `inrole`; a rule of a server for `inrole` (`!disablecommand inrole`, `!restrictcommand inrole`) applies to it as well.
const base = require('./inrole');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  hiddenFromHelp: true,
  legacyRuleNames: ['inrole'],
  // The builder of `inrole` with the name of this command.
  data: Object.assign(Object.create(Object.getPrototypeOf(base.data)), base.data, { name: 'rolemembers' }),
  execute: (interaction, client) => base.execute(interaction, client),
};
