// Umbrella commands (`/server`, `/user`): one slash command that groups what Petto already has as a subcommand each, so the `/` list is
// shorter and people find things by typing `/server` or `/user`. A subcommand either WRAPS an existing command (it takes the same options
// and runs the same code: nothing is copied) or runs a small function of its own. The old commands keep working as they were.
//
// A subcommand is `{ name, wraps, sub? }` (wraps: the file of the command in the folder of the umbrella, which it requires when it runs,
// so the real `execute` is the one that answers; it has the description and the options of that command, or of its subcommand `sub`) or
// `{ name, description, rule, options?, run }`. The rules of a server
// (`!disablecommand`, `!restrictcommand`) use the name of the wrapped command (`serverinfo` for `/server info`) or the `rule` key of a new
// subcommand (`servericon`), and the name of the umbrella turns off all of it (see utils/commandRules.js).
const { ApplicationCommandOptionType } = require('discord.js');

const ADD_OPTION = {
  [ApplicationCommandOptionType.String]: 'addStringOption',
  [ApplicationCommandOptionType.Integer]: 'addIntegerOption',
  [ApplicationCommandOptionType.Number]: 'addNumberOption',
  [ApplicationCommandOptionType.Mentionable]: 'addMentionableOption',
  [ApplicationCommandOptionType.Attachment]: 'addAttachmentOption',
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
      // The limits and the fixed choices of the option go with it, so Discord refuses what the wrapped command would refuse.
      if (option.choices?.length) builder.addChoices(...option.choices.map(({ name, value }) => ({ name, value })));
      if (option.min_value !== undefined) builder.setMinValue(option.min_value);
      if (option.max_value !== undefined) builder.setMaxValue(option.max_value);
      if (option.min_length !== undefined) builder.setMinLength(option.min_length);
      if (option.max_length !== undefined) builder.setMaxLength(option.max_length);
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

/**
 * The interaction a wrapped command gets from an umbrella that wraps one subcommand of a command (`/mod ban` is `ban user`): the same
 * interaction, but `options.getSubcommand()` and `getSubcommandGroup()` answer what the wrapped command expects (`user`, or none when it
 * has no subcommands), as if it had been typed as the old command. Methods run on the real interaction, so what they change (`deferred`,
 * `replied`) is seen by whoever holds the original, and `overrides` are the few values that differ (`commandName`...).
 */
function wrapInteraction(interaction, { subcommand = null, group = null, overrides = {} } = {}) {
  const bound = (target, key) => {
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const options = new Proxy(interaction.options, {
    get(target, key) {
      if (key === 'getSubcommand') {
        return (required = true) => {
          if (!subcommand && required) throw new Error('No subcommand was chosen'); // i18n-ignore: internal error
          return subcommand;
        };
      }
      if (key === 'getSubcommandGroup') {
        return (required = false) => {
          if (!group && required) throw new Error('No subcommand group was chosen'); // i18n-ignore: internal error
          return group;
        };
      }
      return bound(target, key);
    },
  });
  const own = { ...overrides, options };
  const proxy = new Proxy(interaction, {
    get: (target, key) => (Object.hasOwn(own, key) ? own[key] : bound(target, key)),
    set(target, key, value, receiver) {
      // A copy made on top of this one (`Object.create(proxy)`) keeps its own values.
      if (receiver !== proxy) return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true });
      if (Object.hasOwn(own, key)) own[key] = value; else target[key] = value;
      return true;
    },
  });
  return proxy;
}

/** What the prefix reader of the umbrella takes from the wrapped commands: the option that takes every word left, and the function that rewrites the shorter ways of writing it (`!purge bots 50`), by subcommand. */
function prefixOptionsOf(subcommands, load) {
  const greedy = {};
  const argsReaders = {};
  for (const entry of subcommands) {
    if (!entry.wraps) continue;
    const wrapped = load(entry.wraps);
    const text = wrapped.prefixGreedyStringOptions?.[entry.sub ?? '_'];
    if (text) greedy[entry.name] = text;
    if (typeof wrapped.prefixArgs === 'function') argsReaders[entry.name] = wrapped.prefixArgs;
  }
  return { greedy, argsReaders };
}

module.exports = { addSubcommands, runSubcommand, ruleKeysOf, copyOptions, wrapInteraction, prefixOptionsOf };
