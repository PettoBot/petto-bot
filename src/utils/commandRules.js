// The rules a server sets for a command, checked the same way for the prefix and for the slash command:
//   - `!disablecommand` (a command turned off for the server or for a channel);
//   - `!restrictcommand` (only some roles may use it).
// A command whose actions are subcommands (`/act love hug`) can have a rule for one action (`hug`) or for the whole command (`act`),
// and a use is refused by the first rule found, the action's first.
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
  else if (command.rulesBySubcommand && subcommand) names.push(subcommand);
  names.push(command.data.name);
  return [...new Set(names)];
}

/** The subcommand a prefix use will run (`!act love hug @Ana` is `hug`), found in the words typed, or null. */
function subcommandOfText(command, argText) {
  if (!command.rulesBySubcommand) return null;
  return resolveSubcommandOptions(command.data.toJSON(), tokenize(argText))?.subcommand ?? null;
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

module.exports = { ruleNames, subcommandOfText, disabledFor, restrictedForNames };
