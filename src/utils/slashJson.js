// i18n-ignore-file: internal helper, nothing is shown to anybody here
/**
 * The JSON Discord receives for a command: the builder of the command (the one the prefix reads) WITHOUT the subcommands and groups that the command
 * declares in `prefixOnlySubcommands` (paths such as `create` or `group sub`). Those are actions only the Petto team may use (`!channel create`,
 * `!am <token>`): they keep working with the prefix, with the same code, but they are never part of what is registered, so they never show in the `/` menu.
 * A group that is left with no subcommands is dropped too.
 */
const SUBCOMMAND = 1;
const GROUP = 2;

function slashJson(command, { withPrefixOptions = false } = {}) {
  const json = command.data.toJSON();
  // `slashHiddenSubcommands`: subcommands only the `/` menu leaves out (a slash command of its own does the same: `/massban` for `/ban users`). The prefix and the
  // umbrellas that wrap the command (`!modtools mute users`) keep them, so they are dropped only when the menu is being built.
  const dropped = new Set([...(command.prefixOnlySubcommands ?? []), ...(withPrefixOptions ? [] : (command.slashHiddenSubcommands ?? []))]);
  // `prefixOnlyOptions` ({ 'user': ['duration'] }: the options of a subcommand that only the prefix reads): `!ban @x 7d` still takes the duration, `/ban user` does not
  // show it (an option the menu leaves out, if a command declares one). The builder keeps them so the prefix reads them in the same order.
  // An umbrella that wraps the command reads the options for the prefix too (`!mod ban @x 7d`), so it asks for them (`withPrefixOptions`).
  const hidden = withPrefixOptions ? {} : (command.prefixOnlyOptions ?? {});
  if (!dropped.size && !Object.keys(hidden).length) return json;
  const strip = (options, parents) => (options ?? [])
    .filter((option) => !((option.type === SUBCOMMAND || option.type === GROUP) && dropped.has([...parents, option.name].join(' '))))
    .map((option) => {
      if (option.type === GROUP) return { ...option, options: strip(option.options, [...parents, option.name]) };
      if (option.type === SUBCOMMAND && hidden[[...parents, option.name].join(' ')]) {
        const away = new Set(hidden[[...parents, option.name].join(' ')]);
        return { ...option, options: (option.options ?? []).filter((inner) => !away.has(inner.name)) };
      }
      return option;
    })
    .filter((option) => !(option.type === GROUP && !option.options.length));
  return { ...json, options: strip(json.options, []) };
}

/**
 * A command that does one thing most of the time (`/ban`, `/kick`, `/mute`, `/warn`, `/jail`) takes its options directly, not under a subcommand that repeats its name
 * (`/ban user`). The prefix builder keeps the subcommand (`!ban @x`, `!ban remove`...), so the command says in `slashFlatten` which subcommand it is: the registered command
 * gets the options of that one and the rest of the subcommands are served by commands of their own (`/unban`, `/banlist`...). Applied after the descriptions are translated
 * (they are looked up by the path of the subcommand), and `execute` is given that subcommand back (`interactionCreate`, `utils/moderationCommand.asSubcommand`).
 */
function flattenSlash(command, json) {
  const name = command.slashFlatten;
  if (!name) return json;
  const own = (json.options ?? []).find((option) => option.type === SUBCOMMAND && option.name === name);
  if (!own) return json;
  // `slashOptionOrder`: the order of the menu when it is not the one of the builder (the prefix reads the builder's order). Options it does not name keep their place after the named ones.
  const order = command.slashOptionOrder ?? [];
  const rank = (option) => { const at = order.indexOf(option.name); return at === -1 ? order.length : at; };
  const options = order.length ? [...(own.options ?? [])].sort((a, b) => rank(a) - rank(b)) : (own.options ?? []);
  return { ...json, options };
}

module.exports = { slashJson, flattenSlash };
