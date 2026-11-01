// Umbrella commands (`/server`, `/user`): one slash command that groups what Petto already has as a subcommand each, so the `/` list is
// shorter and people find things by typing `/server` or `/user`. A subcommand either WRAPS an existing command (it takes the same options
// and runs the same code: nothing is copied) or runs a small function of its own. The old commands keep working as they were.
//
// A subcommand is `{ name, wraps, sub? }` (wraps: the file of the command in the folder of the umbrella, which it requires when it runs,
// so the real `execute` is the one that answers; it has the description and the options of that command, or of its subcommand `sub`) or
// `{ name, description, rule, options?, run }`. The rules of a server
// (`!disablecommand`, `!restrictcommand`) use the name of the wrapped command (`serverinfo` for `/server info`) or the `rule` key of a new
// subcommand (`servericon`), and the name of the umbrella turns off all of it (see utils/commandRules.js).
//
// A command that has subcommands of its own can be wrapped whole as a GROUP: `{ group: 'antiscam', wraps: 'antiscam' }` becomes the group
// `/protect antiscam` with every subcommand of the wrapped command, each with its options (Discord allows two levels, so a command that
// has groups of its own cannot be wrapped: it is registered by itself). With the prefix, the first word of such an umbrella sends the
// rest to the wrapped command (`!protect antiscam status` is `!antiscam status`: `prefixWordsOf`), so it reads what it takes exactly as
// the old command does, and the rules of the umbrella still apply on top of the ones of the command.
const { ApplicationCommandOptionType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const moderationPermissions = require('./moderationPermissions');
const { permissionLabels } = require('./permissions');
const { t, languageOf } = require('../i18n');
const { aliasesFor } = require('./defaultCommandAliases');

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

const fs = require('node:fs');
const path = require('node:path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
let filesByName = null;

/**
 * Loads a command by its name from whichever folder of src/commands it is in (every file is named as its command), so an umbrella that
 * wraps commands of several folders does not need a list of them. The module is the same one the handler loads.
 */
function loadByName(name) {
  if (!filesByName) {
    filesByName = new Map();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (entry.name.endsWith('.js')) filesByName.set(entry.name.slice(0, -3), path.join(dir, entry.name));
      }
    };
    walk(COMMANDS_DIR);
  }
  const file = filesByName.get(name);
  if (!file) throw new Error(`There is no command file called ${name}`); // i18n-ignore: internal error
  return require(file);
}

/** Adds to a subcommand builder the options of a wrapped command (JSON of its builder), the same names, descriptions and required flags. */
function copyOptions(sub, options) {
  for (const option of options ?? []) {
    const method = ADD_OPTION[option.type];
    if (!method) throw new Error(`An umbrella command cannot copy the option "${option.name}" (type ${option.type}); add its type to utils/umbrella.js`); // i18n-ignore: internal error
    sub[method]((builder) => {
      builder.setName(option.name).setDescription(option.description).setRequired(Boolean(option.required));
      // The list that Discord fills while the option is typed (the wrapped command answers it: see `autocompleteOf`).
      if (option.autocomplete) builder.setAutocomplete(true);
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

/** Adds a subcommand that wraps a command (or one subcommand `sub` of it) to a builder of a subcommand: the same description and options. */
function fillSubcommand(sub, name, node, description = node.description) {
  sub.setName(name).setDescription(description);
  copyOptions(sub, node.options);
  return sub;
}

/** The subcommands of a wrapped command, from its JSON; a command with groups of its own cannot be wrapped whole (Discord allows two levels). */
function subcommandsOfWrapped(entry, json) {
  const subs = (json.options ?? []).filter((option) => option.type === ApplicationCommandOptionType.Subcommand);
  if ((json.options ?? []).some((option) => option.type === ApplicationCommandOptionType.SubcommandGroup) || !subs.length) {
    throw new Error(`/${entry.wraps} cannot be a group of an umbrella: it needs subcommands and no groups of its own`); // i18n-ignore: internal error
  }
  return subs;
}

/**
 * Adds every subcommand and group to the builder of the umbrella; `load(file)` gives the module of a wrapped command. An entry with `group`
 * wraps a whole command as a group (a subcommand for each one of the command, with the same name).
 */
function addSubcommands(builder, subcommands, load) {
  for (const entry of subcommands) {
    if (entry.group) {
      const json = load(entry.wraps).data.toJSON();
      builder.addSubcommandGroup((group) => {
        group.setName(entry.group).setDescription(entry.description ?? json.description);
        for (const node of subcommandsOfWrapped(entry, json)) group.addSubcommand((sub) => fillSubcommand(sub, node.name, node));
        return group;
      });
      continue;
    }
    builder.addSubcommand((sub) => {
      if (!entry.wraps) {
        sub.setName(entry.name).setDescription(entry.description);
        copyOptions(sub, entry.options);
        return sub;
      }
      const json = load(entry.wraps).data.toJSON();
      const node = entry.sub ? json.options.find((option) => option.name === entry.sub) : json;
      return fillSubcommand(sub, entry.name, node);
    });
  }
  return builder;
}

/**
 * The entries of an umbrella with every group opened into the subcommands it holds: `{ group, name, wraps, sub }` each, so the rest of this
 * file (permissions, rules, the executor) looks at one subcommand at a time. Entries without a group are returned as they are.
 */
function expandGroups(subcommands, load) {
  return subcommands.flatMap((entry) => {
    if (!entry.group) return [entry];
    return subcommandsOfWrapped(entry, load(entry.wraps).data.toJSON()).map((node) => ({ group: entry.group, name: node.name, wraps: entry.wraps, sub: node.name }));
  });
}

/** The module that answers a subcommand: the wrapped command, or the one made for it. Looked up when it runs, so it is always the loaded code. */
async function runSubcommand(subcommands, load, interaction, client) {
  const name = interaction.options.getSubcommand();
  const entry = subcommands.find((each) => each.name === name);
  if (!entry) throw new Error(`Unknown subcommand ${name}`); // i18n-ignore: internal error
  if (entry.run) return entry.run(interaction, client);
  return load(entry.wraps).execute(interaction, client);
}

/** `{ subcommand or group: key of the rules }`: the wrapped command's name, or the `rule` of a subcommand that has no old command. */
function ruleKeysOf(subcommands) {
  // A group is named by the command it wraps (`antiscam`), the same key for each of its subcommands.
  return Object.fromEntries(subcommands.map((entry) => [entry.group ?? entry.name, entry.wraps ?? entry.rule]));
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

/**
 * What a subcommand that wraps a command asks of the member: the bit field the wrapped command is registered with (what `/ban` has),
 * or the one of its own action when it has one (`!voice mute` asks for Mute Members, not for the three voice permissions at once), or
 * null for anyone. The wrapped commands that only work with the prefix are never checked by Discord (their `default_member_permissions`
 * is read by the prefix handler, which sees the umbrella as open), so the umbrella has to ask for it.
 */
function permissionBitsOf(load, entry) {
  const wrapped = load(entry.wraps);
  const override = wrapped.prefixPermissionOverrides?.[entry.sub ?? entry.name];
  const raw = override !== undefined ? override : wrapped.data.toJSON().default_member_permissions;
  return raw == null ? null : BigInt(raw);
}

/**
 * Whether the member may use what the subcommand wraps, for the slash command and the prefix alike: the permission the wrapped command
 * asks for, or the role chosen for it with `!moderation` (administrators and the owner always). Answers `{ ok, roleAllowed }`; when it is
 * not allowed the person has been told, in private. What the wrapped command checks by itself (the permission of the bot, the role
 * hierarchy, who may be a target) is still its own and runs after.
 */
async function checkPermission(load, interaction, entry) {
  const wrapped = load(entry.wraps);
  const needed = permissionBitsOf(load, entry);
  if (needed === null) return { ok: true, roleAllowed: false };
  const member = interaction.member;
  const guildId = interaction.guildId ?? interaction.guild?.id;
  // The role a server chose for this command (`!moderation allow ban @Mods`) only stands in for the Discord permission.
  const roleAllowed = member && guildId ? await moderationPermissions.hasConfiguredRole(guildId, wrapped.data.name, member).catch(() => false) : false;
  // Anything that is not a clear yes (no member, permissions that are not a bit field) is a no.
  if (roleAllowed || (typeof member?.permissions?.has === 'function' && member.permissions.has(needed) === true)) return { ok: true, roleAllowed };
  const lang = await languageOf(interaction);
  await interaction.reply({ content: t(lang, 'core.moderate.youNeed', { permission: permissionLabels(needed, lang) }), flags: MessageFlags.Ephemeral });
  return { ok: false, roleAllowed };
}

/** The subcommand that was chosen: the entry of the list with this name (inside this group, when it has one). */
function findLeaf(subcommands, group, name) {
  return subcommands.find((entry) => entry.name === name && (entry.group ?? null) === (group ?? null));
}

/** The interaction a wrapped command gets for a subcommand of an umbrella (see `wrapInteraction`). */
function wrappedInteraction(interaction, entry, wrapped) {
  return wrapInteraction(interaction, { subcommand: entry.sub ?? null, overrides: { commandName: wrapped.data.name } });
}

/**
 * The `execute`, `autocomplete` and `!help` hook of an umbrella that wraps commands with `{ name, wraps, sub? }` entries (or the subcommands of
 * a group, `{ group, name, wraps, sub }`: pass the list from `expandGroups`): it asks for the permission of the wrapped command, then runs its
 * own code with its own subcommand (`/mod ban` is `ban user`, `/game minecraft` is `minecraft user`, `/protect antiscam set` is `antiscam set`).
 * Every umbrella that wraps commands uses it, so the gate does not depend on remembering it: a command with no permission is open.
 */
function wrappedExecutor(load, subcommands) {
  return {
    /** What `!help <umbrella> <sub>` says is needed (a bit field, or null); for a group the first word is the group and the second the subcommand. */
    permissionForSubcommand(name, sub = null) {
      const entry = sub ? findLeaf(subcommands, name, sub) : findLeaf(subcommands, null, name) ?? subcommands.find((each) => each.group === name);
      return entry ? permissionBitsOf(load, entry) : null;
    },
    async execute(interaction, client) {
      const name = interaction.options.getSubcommand();
      const entry = findLeaf(subcommands, interaction.options.getSubcommandGroup?.(false), name);
      if (!entry) throw new Error(`Unknown subcommand ${name}`); // i18n-ignore: internal error
      const wrapped = load(entry.wraps);
      const { ok, roleAllowed } = await checkPermission(load, interaction, entry);
      if (!ok) return undefined;
      // The wrapped command reads its own subcommand (`ban user`) and its own configured role, as if it had been typed as the old command.
      return wrapped.execute(wrapInteraction(interaction, {
        subcommand: entry.sub ?? null,
        overrides: { commandName: wrapped.data.name, pettoModerationRoleAllowed: roleAllowed },
      }), client);
    },
    /**
     * The list Discord fills while an option is typed: the wrapped command answers it for the option being typed, as if it were its own
     * subcommand. A member who may not use the subcommand gets an empty list (what the command would list is not for them), and so does a
     * wrapped command that has none.
     */
    async autocomplete(interaction) {
      const entry = findLeaf(subcommands, interaction.options.getSubcommandGroup?.(false), interaction.options.getSubcommand(false));
      const wrapped = entry ? load(entry.wraps) : null;
      if (!wrapped || typeof wrapped.autocomplete !== 'function') return interaction.respond([]);
      const needed = permissionBitsOf(load, entry);
      if (needed !== null) {
        const guildId = interaction.guildId ?? interaction.guild?.id;
        const roleAllowed = interaction.member && guildId ? await moderationPermissions.hasConfiguredRole(guildId, wrapped.data.name, interaction.member).catch(() => false) : false;
        if (!roleAllowed && !(typeof interaction.member?.permissions?.has === 'function' && interaction.member.permissions.has(needed) === true)) return interaction.respond([]);
      }
      return wrapped.autocomplete(wrappedInteraction(interaction, entry, wrapped));
    },
  };
}

/**
 * What the prefix does with the first word of an umbrella that wraps commands as groups or as subcommands of other names: `{ word: { command, args } }`,
 * read by the prefix handler (`prefixWords`) to send the rest of the message to the wrapped command. `!protect antiscam status` is `!antiscam status`, and
 * `!config recommended` is `!cmdconfig`. A word is the name of the group or subcommand, and every alias of the wrapped command (`!auto ar` is `!autoresponder`)
 * that no other entry of the umbrella uses. The wrapped command reads the rest exactly as it always did, so what it takes in the prefix (the embed
 * code, the words of its aliases, its default subcommand) does not have to be copied, and its own permission and rules are the ones that apply.
 */
function prefixWordsOf(subcommands, load) {
  const words = {};
  const names = new Set(subcommands.map((entry) => entry.group ?? entry.name));
  for (const entry of subcommands) {
    if (!entry.wraps) continue;
    const key = entry.group ?? entry.name;
    const route = { command: entry.wraps, args: entry.group || !entry.sub ? [] : [entry.sub] };
    words[key] = route;
    for (const alias of [...(load(entry.wraps).aliases ?? []), ...aliasesFor(entry.wraps)]) if (!names.has(alias) && !words[alias]) words[alias] = route;
  }
  return words;
}

/**
 * A whole umbrella command from its list: `{ group, wraps }` (a command with subcommands, as a group), `{ name, wraps, sub? }` (a command
 * with none, or one of its subcommands, as a subcommand). Everything an umbrella needs is made here, the same for all of them:
 *   - the builder (open to everybody: `default_member_permissions` is null, and not offered in DMs), registered as a slash command too;
 *   - `execute` asks for the permission of the wrapped command (or the role chosen with `!moderation`) and runs it; `autocomplete` is the
 *     wrapped command's own;
 *   - the prefix sends the first word to the wrapped command (`prefixWords`), `!<umbrella>` alone lists what it holds, and the rules of a
 *     server (`!disablecommand`, `!restrictcommand`, a permission level) name the wrapped command, or the umbrella to stop all of it.
 */
function defineUmbrella({ name, description, subcommands, load = loadByName }) {
  const leaves = expandGroups(subcommands, load);
  const executor = wrappedExecutor(load, leaves);
  return {
    registerSlash: true,
    umbrella: true,
    listSubcommandsWhenEmpty: true,
    prefixWords: prefixWordsOf(leaves, load),
    rulesBySubcommand: true,
    ruleKeys: ruleKeysOf(leaves),
    permissionForSubcommand: executor.permissionForSubcommand,
    // The entries and what each one wraps (read by the tests and by the translations).
    subcommands,
    leaves,
    data: addSubcommands(new SlashCommandBuilder().setName(name).setDMPermission(false).setDescription(description), subcommands, load),
    execute: executor.execute,
    autocomplete: executor.autocomplete,
  };
}

module.exports = { defineUmbrella, loadByName, addSubcommands, expandGroups, prefixWordsOf, findLeaf, runSubcommand, ruleKeysOf, copyOptions, wrapInteraction, prefixOptionsOf, permissionBitsOf, checkPermission, wrappedExecutor };
