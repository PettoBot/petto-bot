// i18n-ignore-file: internal helper, nothing is shown to anybody here
/**
 * The JSON Discord receives for a command: the builder of the command (the one the prefix reads) WITHOUT the subcommands and groups that the command
 * declares in `prefixOnlySubcommands` (paths such as `create` or `group sub`). Those are actions only the Petto team may use (`!channel create`,
 * `!am <token>`): they keep working with the prefix, with the same code, but they are never part of what is registered, so they never show in the `/` menu.
 * A group that is left with no subcommands is dropped too.
 */
const SUBCOMMAND = 1;
const GROUP = 2;

function slashJson(command) {
  const json = command.data.toJSON();
  const dropped = new Set(command.prefixOnlySubcommands ?? []);
  if (!dropped.size) return json;
  const strip = (options, parents) => (options ?? [])
    .filter((option) => !((option.type === SUBCOMMAND || option.type === GROUP) && dropped.has([...parents, option.name].join(' '))))
    .map((option) => (option.type === GROUP ? { ...option, options: strip(option.options, [...parents, option.name]) } : option))
    .filter((option) => !(option.type === GROUP && !option.options.length));
  return { ...json, options: strip(json.options, []) };
}

module.exports = { slashJson };
