// /imagemute: Takes away the files and embeds of a member in every channel, or gives them back. A slash command of its own with a whole-word name (the prefix word is `!imute`; `!imagemute` works too), registered in each server (the second set of slash
// commands). It has the options and runs the code of `imute`; a rule of a server for `imute` (`!disablecommand imute`, `!restrictcommand imute`) applies to it as well.
const base = require('./imute');

module.exports = {
  registerSlash: true,
  // `/imagemute` takes the options of its `user` subcommand directly (no `/imagemute user`): the rest is served by commands of their own (utils/slashJson.js `flattenSlash`).
  slashFlatten: 'user',
  guildScoped: true,
  hiddenFromHelp: true,
  legacyRuleNames: ['imute'],
  // The builder of `imute` with the name of this command.
  data: Object.assign(Object.create(Object.getPrototypeOf(base.data)), base.data, { name: 'imagemute' }),
  execute: (interaction, client) => base.execute(interaction, client),
};
