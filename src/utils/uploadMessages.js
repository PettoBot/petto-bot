const { t, currentLanguage } = require('../i18n');

const MAX_TEXT = 2000;

/** The welcome of a first upload when the server did not write one. */
const defaultWelcome = (lang = currentLanguage()) => t(lang, 'uploads.welcome.default');

/** The words of the welcome: the saved text, or the default. */
function textOf(saved, fallback = defaultWelcome()) {
  const text = typeof saved?.text === 'string' ? saved.text.trim() : '';
  return text ? text.slice(0, MAX_TEXT) : fallback;
}

module.exports = { defaultWelcome, MAX_TEXT, textOf };
