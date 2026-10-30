// i18n-ignore-file: command and subcommand names people type, never translated
/**
 * Short, prefix-only words for the subcommands of the commands people type most (`!is` is `!image sepia`, `!tko` is `!ticket open`) and
 * for a few long commands. The table is DATA: src/utils/short-aliases.json, an object `{ alias: "command" | "command subcommand" }`
 * written by `npm run gen:short-aliases` (scripts/gen-short-aliases.js) and committed, so an alias never changes meaning when a command
 * is added later: the generator only ever adds, and a check fails if anything in the table collides with another name.
 *
 * It is read once, when this file is loaded, into a plain list of routes (the shape of DEFAULT_PREFIX_ROUTES); the command loader then
 * puts them in the same Map as every other route, so typing a word is one `Map.get`: nothing here runs per message.
 * Each is the normal prefix route of the real command, so its permissions and the `!disablecommand` and `!restrictcommand` rules apply.
 */
const TABLE = require('./short-aliases.json');

let routes = null;

/** The routes of the table, in the shape of DEFAULT_PREFIX_ROUTES (`short: true` marks them for the checks, the docs and the loader). */
function shortAliasRoutes() {
  if (routes) return routes;
  routes = Object.entries(TABLE).map(([alias, target]) => {
    const [command, ...rest] = target.split(' ');
    const route = { alias, command, args: rest, short: true };
    if (rest.length) route.subcommand = rest.join(' ');
    return route;
  });
  return routes;
}

module.exports = { SHORT_ALIAS_TABLE: TABLE, shortAliasRoutes };
