// Errors that only say the bot is missing a permission in a channel. They are the server's to fix, not a bug, so they are told to the
// member in plain words and kept out of the channel of errors.
const { t, currentLanguage } = require('../i18n');

// The messages Discord sends with each code (matched, never shown). i18n-ignore: Discord's own error texts, matched
const CODES = new Map([
  [50013, 'Missing Permissions'], // i18n-ignore: Discord's error text, matched
  [50001, 'Missing Access'], // i18n-ignore: Discord's error text, matched
  [160002, 'Read Message History'], // i18n-ignore: Discord's error text, matched
  [50007, 'Cannot send messages to this user'], // i18n-ignore: Discord's error text, matched
  [40333, 'Cannot send messages in this channel'], // i18n-ignore: Discord's error text, matched
]);

const isPermissionError = (error) => Boolean(error) && CODES.has(error.code);

/**
 * What to tell the member when a command could not run because of a permission. With `{ guild, feature }` it also says exactly what is missing and where, from the error itself
 * (utils/permissionAlerts.ts), and the problem is saved and told to the staff of the server (once a day at most). Without them, or when it cannot be known, the generic text.
 */
function permissionHelp(error, lang = currentLanguage(), context = null) {
  if (context?.guild) {
    const { explain, reportPermissionProblem } = require('./permissionAlerts');
    reportPermissionProblem(error, context).catch(() => {});
    const exact = explain(error, lang, context.guild);
    if (exact) return exact;
  }
  if (error?.code === 160002) return t(lang, 'core.permission.readHistory');
  if (error?.code === 50001) return t(lang, 'core.permission.viewChannel');
  return t(lang, 'core.permission.generic');
}

/** The text of an error a command threw on purpose to tell the member something (`userFacing`, already in their language), or null for any other error. It is not a bug: it is shown, and kept out of the channel of errors. */
const userFacingText = (error) => (error?.userFacing && typeof error.message === 'string' && error.message.trim() ? error.message.slice(0, 1900) : null);

/** For a failure nobody answers to (an event, a job, a rejection nobody caught): the problem is saved and the staff is told. `guild` can be missing: it is found from the address of the request. */
function notePermissionProblem(client, error, { guild = null, feature = 'task' } = {}) {
  if (!isPermissionError(error)) return;
  const { reportPermissionProblem, guildOf } = require('./permissionAlerts');
  const found = guild ?? guildOf(client, error);
  if (found) reportPermissionProblem(error, { guild: found, feature }).catch(() => {});
}

module.exports = { isPermissionError, permissionHelp, notePermissionProblem, userFacingText };
