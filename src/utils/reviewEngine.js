// Stars and averages, and the check of a review before it is saved.
const { t, currentLanguage } = require('../i18n');

const MAX_COMMENT = 300;

/** `{ count, average }` of some reviews; the average has one decimal and is null with no reviews. */
function summarize(reviews) {
  if (!reviews.length) return { count: 0, average: null };
  const total = reviews.reduce((sum, review) => sum + review.stars, 0);
  return { count: reviews.length, average: Math.round((total / reviews.length) * 10) / 10 };
}

/** Five stars as text: filled and empty. */
function starsText(stars) {
  const full = Math.max(0, Math.min(5, Math.round(stars)));
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

/** Reads the stars from `4`, `4/5` or `4 stars`; null when they are not a whole number from 1 to 5. */
function parseStars(value) {
  const match = String(value ?? '').trim().match(/^([1-5])(?:\s*\/\s*5|\s*stars?|\s*★)?$/i);
  return match ? Number(match[1]) : null;
}

/** Why a review is refused, or null when it is fine. */
function problem({ reviewer, target, stars, comment, lang = currentLanguage() }) {
  if (target.bot) return t(lang, 'reviews.problem.bot');
  if (reviewer.id === target.id) return t(lang, 'reviews.problem.self');
  if (stars === null) return t(lang, 'reviews.problem.stars');
  if (comment.length > MAX_COMMENT) return t(lang, 'reviews.problem.comment', { max: MAX_COMMENT });
  return null;
}

module.exports = { MAX_COMMENT, summarize, starsText, parseStars, problem };
