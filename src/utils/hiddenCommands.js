// i18n-ignore-file: internal helpers, nothing is shown to anybody here
/**
 * A command marked `hiddenEverywhere` (today only `/music`, discarded for now) is not listed anywhere a person can see a command: it is not registered
 * with Discord, not in `!help` (not even for the team: `hiddenFromHelp` shows to the team, this does not), not in the suggestions of a mistyped word,
 * not in the lists of commands, not in the catalogs of the website and not in the tables of short aliases that are published. The words that reach it
 * (its name, its aliases, its routes) still work with the prefix for the Petto team (the owner and PETTO_DEVELOPER_IDS); for everybody else they are
 * not commands at all: no answer, no suggestion, the message is just a message.
 *
 * A command marked `teamOnly` (the private tools of the team: `!slots`, `!botstatus`, `!leaveguild`, `!guildsend`...) has the same silence for everybody outside
 * the team (the typing indicator and "unknown command" included) but is still listed for the team in `!help` (`hiddenFromHelp`) and in `!team`.
 */
const { isPettoOperator } = require('./autoModControl');

/** Whether a loaded command is hidden everywhere (a getter on the command, so an opt-in of the environment can bring it back). */
const isHiddenEverywhere = (command) => Boolean(command && command.hiddenEverywhere);

/** Whether a command does not exist for anybody outside the team: hidden everywhere, or a private tool of the team. */
const isTeamOnly = (command) => Boolean(command && (command.hiddenEverywhere || command.teamOnly));

/**
 * Whether a command does not exist FOR THIS PERSON: hidden everywhere or a team tool and the person is not in the team, or a tool only the OWNER may use
 * (`ownerOnly`, such as `!premiumadmin`) and the person is not the owner (a developer is not). Nothing is answered to them.
 */
function isHiddenFrom(command, userId) {
  if (!isTeamOnly(command)) return false;
  // Read when it is needed: loading the configuration needs the environment of a running bot, and this module is also loaded by checks and tools.
  if (command.ownerOnly) return String(userId ?? '') !== String(require('../config').ownerId);
  return !isPettoOperator(userId);
}

/** The command a typed word reaches (a command name, an alias or a route), or undefined. */
function commandOfWord(client, word) {
  const name = String(word ?? '').toLowerCase();
  if (!name) return undefined;
  const direct = client.commands?.get(name);
  if (direct) return direct;
  const aliased = client.commandAliases?.get(name);
  if (aliased) return client.commands?.get(aliased);
  const route = client.commandRoutes?.get(name);
  return route ? client.commands?.get(route.command) : undefined;
}

/** Whether a typed word is something that does not exist for this person: it reaches a hidden command and the person is not in the team. */
function isHiddenWordFor(client, word, userId) {
  return isHiddenFrom(commandOfWord(client, word), userId);
}

/** The loaded commands that a person can see in a list (a name, a suggestion, a count): everything but the hidden ones. */
function listedCommands(client) {
  return [...client.commands.values()].filter((command) => !isHiddenEverywhere(command));
}

module.exports = { isHiddenEverywhere, isTeamOnly, isHiddenFrom, commandOfWord, isHiddenWordFor, listedCommands };
