// The problems of the outside sources of quests and rollouts ("answered 503", "it took too long") are logged in English and kept
// that way in memory; this says them in the language of the reader when a status or an error is shown.
const { t, currentLanguage } = require('../i18n');

// i18n-ignore-next-line: the English texts the sources produce, matched to find their translation
const PATTERNS = [
  [/^answered (\d+), too many requests$/, (m) => ['common.source.rateLimited', { status: m[1] }]],
  [/^answered (\d+)$/, (m) => ['common.source.answered', { status: m[1] }]],
  [/^the answer is too large$/, () => ['common.source.tooLarge']],
  [/^the answer has an unexpected shape$/, () => ['common.source.badShape']],
  [/^the list came back empty$/, () => ['common.source.empty']],
  [/^it took too long$/, () => ['common.source.timeout']],
  [/^paused after a rate limit, until (\S+)$/, (m) => ['common.source.paused', { until: Number.isFinite(Date.parse(m[1])) ? `<t:${Math.floor(Date.parse(m[1]) / 1000)}:R>` : m[1] }]],
];

/** One problem of a source in `lang`; a text that is not one of the known ones (a network error…) is shown as it is. */
function sourceProblem(text, lang = currentLanguage()) {
  const value = String(text ?? '');
  for (const [pattern, toKey] of PATTERNS) {
    const match = pattern.exec(value);
    if (match) {
      const [key, vars] = toKey(match);
      return t(lang, key, vars);
    }
  }
  // "The quests could not be read: <source> <problem>; <source> <problem>"
  const all = /^The quests could not be read: (.+)$/.exec(value); // i18n-ignore: matched
  if (all) {
    const parts = all[1].split('; ').map((part) => {
      const space = part.indexOf(' ');
      return space === -1 ? part : `${part.slice(0, space)} ${sourceProblem(part.slice(space + 1), lang)}`;
    });
    return t(lang, 'common.source.questsUnreadable', { problems: parts.join('; ') });
  }
  return value;
}

module.exports = { sourceProblem };
