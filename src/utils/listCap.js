// A list that can grow without bound (the cases of a mass unban, the members of a mass ban) shown with its first items and "and N more",
// so the result of a command never passes the length of a text display. The counts are always complete in the sentence around it.
const { tn } = require('../i18n');

const CASE_LIMIT = 20;
const MENTION_LIMIT = 25;

/** The first `limit` items and how many were left out. */
function capList(items, limit) {
  const all = Array.isArray(items) ? items : [...(items ?? [])];
  return { shown: all.slice(0, limit), hidden: Math.max(0, all.length - limit) };
}

/** The items joined with `separator`, followed by "and N more" when some were left out. */
function listWithMore(lang, items, { limit = MENTION_LIMIT, separator = ', ', format = String } = {}) {
  const { shown, hidden } = capList(items, limit);
  const text = shown.map(format).join(separator);
  return hidden ? `${text} ${tn(lang, 'moderation.common.andMore', hidden)}` : text;
}

/** The case numbers of a bulk action for a `{list}` that is written after a `#`: "1, #2, #3 and 40 more" (the first 20). */
function caseNumberList(lang, numbers, limit = CASE_LIMIT) {
  return listWithMore(lang, numbers, { limit, separator: ', #' });
}

/** Mentions, or any items that print well with `${item}`, separated by a space, the first 25. */
function mentionList(lang, users, limit = MENTION_LIMIT) {
  return listWithMore(lang, users, { limit, separator: ' ', format: (user) => `${user}` });
}

module.exports = { CASE_LIMIT, MENTION_LIMIT, capList, listWithMore, caseNumberList, mentionList };
