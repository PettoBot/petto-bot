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
  const dropped = new Set(command.prefixOnlySubcommands ?? []);
  // `prefixOnlyOptions` ({ 'user': ['duration'] }: the options of a subcommand that only the prefix reads): `!ban @x 7d` still takes the duration, `/ban user` does not
  // show it (the temporary ban is `/tempban`). The builder keeps them so the prefix reads them in the same order.
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

module.exports = { slashJson };
