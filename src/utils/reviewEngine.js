// Stars and averages, and the check of a review before it is saved.
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
function problem({ reviewer, target, stars, comment }) {
  if (target.bot) return 'You can not review a bot.';
  if (reviewer.id === target.id) return 'You can not review yourself.';
  if (stars === null) return 'The stars are a whole number from 1 to 5.';
  if (comment.length > MAX_COMMENT) return `The comment can have up to ${MAX_COMMENT} characters.`;
  return null;
}

module.exports = { MAX_COMMENT, summarize, starsText, parseStars, problem };
