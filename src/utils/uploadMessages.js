const DEFAULT_WELCOME = 'Thanks for your first upload, {user.mention}! You are an uploader now.';
const MAX_TEXT = 2000;

/** The words of the welcome: the saved text, or the default. */
function textOf(saved, fallback = DEFAULT_WELCOME) {
  const text = typeof saved?.text === 'string' ? saved.text.trim() : '';
  return text ? text.slice(0, MAX_TEXT) : fallback;
}

module.exports = { DEFAULT_WELCOME, MAX_TEXT, textOf };
