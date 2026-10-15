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

/** What to tell the member when a command could not run because of a permission. */
function permissionHelp(error, lang = currentLanguage()) {
  if (error?.code === 160002) return t(lang, 'core.permission.readHistory');
  if (error?.code === 50001) return t(lang, 'core.permission.viewChannel');
  return t(lang, 'core.permission.generic');
}

module.exports = { isPermissionError, permissionHelp };
