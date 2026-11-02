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

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * Why a review is refused, or null when it is fine. `config` has the rules of the server (all of them off by default): the minimum age of the account
 * and time in the server, the cooldown and the length of the comment. `reviewerMember` is the member (for the time in the server) and `lastAt` when the
 * reviewer last saved a review. A rule whose fact is not known (a member that is not in memory) does not refuse.
 */
function problem({ reviewer, target, stars, comment, lang = currentLanguage(), config = {}, reviewerMember = null, lastAt = null, now = Date.now() }) {
  if (target.bot) return t(lang, 'reviews.problem.bot');
  if (reviewer.id === target.id) return t(lang, 'reviews.problem.self');
  if (stars === null) return t(lang, 'reviews.problem.stars');
  const max = Math.min(MAX_COMMENT, config.max_comment > 0 ? config.max_comment : MAX_COMMENT);
  if (comment.length > max) return t(lang, 'reviews.problem.comment', { max });
  if (config.min_comment > 0 && comment.length < config.min_comment) return t(lang, 'reviews.problem.commentShort', { min: config.min_comment });
  if (config.min_account_days > 0 && reviewer.createdTimestamp && now - reviewer.createdTimestamp < config.min_account_days * DAY_MS) return t(lang, 'reviews.problem.account', { days: config.min_account_days });
  if (config.min_member_days > 0 && reviewerMember?.joinedTimestamp && now - reviewerMember.joinedTimestamp < config.min_member_days * DAY_MS) return t(lang, 'reviews.problem.member', { days: config.min_member_days });
  if (config.cooldown_minutes > 0 && lastAt) {
    const next = new Date(lastAt).getTime() + config.cooldown_minutes * MINUTE_MS;
    if (next > now) return t(lang, 'reviews.problem.cooldown', { time: `<t:${Math.ceil(next / 1000)}:R>` });
  }
  return null;
}

module.exports = { MAX_COMMENT, summarize, starsText, parseStars, problem };
