// What to answer when a command that sets a saved embed is used without the name of one: instead of an error about a missing argument,
// it says which one is in use now and which ones exist, so the next try can be right.
const { listTemplates } = require('../db/embedTemplates');
const { t, currentLanguage } = require('../i18n');

/**
 * `current` is the saved embed in use (or empty), `usage` the way to set one (for example `!bumpreminder template reminder <name>`).
 * `what` names the message in `lang` (the caller translates it). Returns the text of the answer.
 */
async function templateHint(guildId, { current, usage, what = 'message', lang = currentLanguage() } = {}) {
  const rows = await listTemplates(guildId).catch(() => []);
  const names = rows.map((row) => row.name);
  // `current` left out means it is not known here, so nothing is said about it.
  const lines = current === undefined ? [] : [current ? t(lang, 'core.template.current', { what, name: current }) : t(lang, 'core.template.usual', { what })];
  if (names.length) {
    const shown = names.slice(0, 15).map((name) => `\`${name}\``).join(', ');
    lines.push(names.length > 15 ? t(lang, 'core.template.listMore', { list: shown, count: names.length - 15 }) : t(lang, 'core.template.list', { list: shown }));
  } else {
    lines.push(t(lang, 'core.template.none'));
  }
  if (usage) lines.push(t(lang, 'core.template.choose', { usage }));
  return lines.join('\n');
}

module.exports = { templateHint };
