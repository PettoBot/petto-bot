// Umbrella commands (`/server`, `/user`): one slash command that groups what Petto already has as a subcommand each, so the `/` list is
// shorter and people find things by typing `/server` or `/user`. A subcommand either WRAPS an existing command (it takes the same options
// and runs the same code: nothing is copied) or runs a small function of its own. The old commands keep working as they were.
//
// A subcommand is `{ name, wraps, sub? }` (wraps: the file of the command in src/commands/info, which the umbrella requires when it runs,
// so the real `execute` is the one that answers; it has the description and the options of that command, or of its subcommand `sub`) or
// `{ name, description, rule, options?, run }`. The rules of a server
// (`!disablecommand`, `!restrictcommand`) use the name of the wrapped command (`serverinfo` for `/server info`) or the `rule` key of a new
// subcommand (`servericon`), and the name of the umbrella turns off all of it (see utils/commandRules.js).
const { ApplicationCommandOptionType } = require('discord.js');

const ADD_OPTION = {
  [ApplicationCommandOptionType.String]: 'addStringOption',
  [ApplicationCommandOptionType.Integer]: 'addIntegerOption',
  [ApplicationCommandOptionType.Boolean]: 'addBooleanOption',
  [ApplicationCommandOptionType.User]: 'addUserOption',
  [ApplicationCommandOptionType.Channel]: 'addChannelOption',
  [ApplicationCommandOptionType.Role]: 'addRoleOption',
};

/** Adds to a subcommand builder the options of a wrapped command (JSON of its builder), the same names, descriptions and required flags. */
function copyOptions(sub, options) {
  for (const option of options ?? []) {
    const method = ADD_OPTION[option.type];
    if (!method) throw new Error(`An umbrella command cannot copy the option "${option.name}" (type ${option.type}); add its type to utils/umbrella.js`); // i18n-ignore: internal error
    sub[method]((builder) => {
      builder.setName(option.name).setDescription(option.description).setRequired(Boolean(option.required));
      if (option.channel_types?.length) builder.addChannelTypes(...option.channel_types);
      return builder;
    });
  }
}

/** Adds every subcommand to the builder of the umbrella; `load(file)` gives the module of a wrapped command. */
function addSubcommands(builder, subcommands, load) {
  for (const entry of subcommands) {
    builder.addSubcommand((sub) => {
      if (!entry.wraps) {
        sub.setName(entry.name).setDescription(entry.description);
        copyOptions(sub, entry.options);
        return sub;
      }
      const json = load(entry.wraps).data.toJSON();
      const node = entry.sub ? json.options.find((option) => option.name === entry.sub) : json;
      sub.setName(entry.name).setDescription(node.description);
      copyOptions(sub, node.options);
      return sub;
    });
  }
  return builder;
}

/** The module that answers a subcommand: the wrapped command, or the one made for it. Looked up when it runs, so it is always the loaded code. */
async function runSubcommand(subcommands, load, interaction, client) {
  const name = interaction.options.getSubcommand();
  const entry = subcommands.find((each) => each.name === name);
  if (!entry) throw new Error(`Unknown subcommand ${name}`); // i18n-ignore: internal error
  if (entry.run) return entry.run(interaction, client);
  return load(entry.wraps).execute(interaction, client);
}

/** `{ subcommand: key of the rules }`: the wrapped command's name, or the `rule` of a subcommand that has no old command. */
function ruleKeysOf(subcommands) {
  return Object.fromEntries(subcommands.map((entry) => [entry.name, entry.wraps ?? entry.rule]));
}

module.exports = { addSubcommands, runSubcommand, ruleKeysOf, copyOptions };
