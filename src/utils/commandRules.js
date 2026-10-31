// The rules a server sets for a command, checked the same way for the prefix and for the slash command:
//   - `!disablecommand` (a command turned off for the server or for a channel);
//   - `!restrictcommand` (only some roles may use it).
// A command whose actions are subcommands (`/act love hug`) can have a rule for one action (`hug`) or for the whole command (`act`),
// and a use is refused by the first rule found, the action's first.
// An umbrella command (`/server`, `/user`: utils/umbrella.js) names the rule of each subcommand with `ruleKeys`: the old command it wraps
// (`/server info` is `serverinfo`, `/user avatar` is `avatar`) or the key of a new subcommand (`servericon`), so a rule that existed
// before for `serverinfo` also reaches `/server info` and `!server`, and `server` turns off all of them.
const disabledDb = require('../db/disabledCommands');
const { restrictedFor } = require('./commandRestrictions');
const { tokenize, resolveSubcommandOptions } = require('../handlers/prefixInteraction');

/**
 * The names a rule for this use can be saved under, the most specific first: the action (`hug`), then the command (`act`).
 * `route` is the prefix route that was typed (`!hug`), `subcommand` the subcommand that was chosen (`hug` of `/act love hug`).
 */
function ruleNames(command, { route = null, subcommand = null } = {}) {
  const names = [];
  if (route?.disableName) names.push(route.disableName);
  else if (command.rulesBySubcommand && subcommand) names.push(command.ruleKeys?.[subcommand] ?? subcommand);
  names.push(command.data.name);
  return [...new Set(names)];
}

/** The names a custom permission level (`!permissions`) is looked up under: the command, and the old command a subcommand wraps. */
function permissionNames(command, { subcommand = null } = {}) {
  const wrapped = command.ruleKeys && subcommand ? command.ruleKeys[subcommand] : null;
  return [...new Set([command.data.name, wrapped].filter(Boolean))];
}

/**
 * The subcommand a prefix use will run (`!act love hug @Ana` is `hug`), found in the words typed, or null. Like the parser, it reads the
 * words that stand for a subcommand (`!user pfp` is `avatar`) and the subcommand used when none is typed (`!server` is `info`).
 */
function subcommandOfText(command, argText) {
  if (!command.rulesBySubcommand) return null;
  const json = command.data.toJSON();
  const tokens = tokenize(argText);
  if (tokens[0]) tokens[0] = command.prefixSubcommandAliases?.[tokens[0].toLowerCase()] ?? tokens[0];
  const fallback = typeof command.prefixDefaultSubcommand === 'function' ? command.prefixDefaultSubcommand(tokens) : command.prefixDefaultSubcommand;
  const resolved = resolveSubcommandOptions(json, tokens) ?? (fallback ? resolveSubcommandOptions(json, [fallback, ...tokens]) : null);
  return resolved?.subcommand ?? null;
}

/** The first rule that turns the command off here: `{ name, row }` (the name it was saved under, the rule), or null. */
async function disabledFor(guildId, names, channelId, store = disabledDb) {
  for (const name of names) {
    const row = await store.findCached(guildId, name, channelId).catch(() => null);
    if (row) return { name, row };
  }
  return null;
}

/** The first role restriction the member does not meet: `{ name, roles }` (the roles that may use it), or null. */
async function restrictedForNames(guildId, names, member, check = restrictedFor) {
  for (const name of names) {
    const roles = await check(guildId, name, member);
    if (roles) return { name, roles };
  }
  return null;
}

module.exports = { ruleNames, permissionNames, subcommandOfText, disabledFor, restrictedForNames };
