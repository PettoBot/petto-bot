// The personal verification link of a member, and whether Petto can give one at all. `VERIFY_BASE_URL` has to be a public http(s)
// address (Discord does not open a link to localhost, nor one without its scheme), and `VERIFY_TOKEN_SECRET` has to be set to sign it.
// When it cannot, the member is told so (and gets the letters inside Discord instead, when the secret is there) and the owner of the
// bot gets one clear warning in the log, instead of a link that does not open.
const config = require('../config');
const { createToken, DEFAULT_TTL_SECONDS } = require('./verifyToken');
const logger = require('./logger');
const { inDiscord, usesLink } = require('./verifyMethod');

const LOCAL_HOSTS = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|::1)$/i;

/** The base address, cleaned: no spaces or trailing slash, and `https://` added when it has no scheme. Null when it cannot be one. */
function baseUrl(raw = config.verifyBaseUrl) {
  let text = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Why no link can be given, or null when it can: `missing` (no VERIFY_BASE_URL), `secret` (no VERIFY_TOKEN_SECRET), `invalid` (not an
 * address) or `local` (localhost, which only opens on the computer of the bot).
 */
function linkProblem({ base = config.verifyBaseUrl, secret = config.verifyTokenSecret } = {}) {
  if (!String(base ?? '').trim()) return 'missing';
  if (!secret) return 'secret';
  const clean = baseUrl(base);
  if (!clean) return 'invalid';
  if (LOCAL_HOSTS.test(new URL(clean).hostname)) return 'local';
  return null;
}

const warned = new Set();
/** Says once (per reason) in the log why members get no link, so it is fixed in the bot's settings. */
function warnOperator(problem, guildId) {
  if (!problem || warned.has(problem)) return;
  warned.add(problem);
  const why = {
    missing: 'VERIFY_BASE_URL is not set', // i18n-ignore: operator log
    secret: 'VERIFY_TOKEN_SECRET is not set', // i18n-ignore: operator log
    invalid: `VERIFY_BASE_URL is not a web address (${String(config.verifyBaseUrl).slice(0, 80)})`, // i18n-ignore: operator log
    local: `VERIFY_BASE_URL points to this computer (${String(config.verifyBaseUrl).slice(0, 80)}), Discord users cannot open it`, // i18n-ignore: operator log
  }[problem];
  logger.warn(`Verification links cannot be given${guildId ? ` (guild ${guildId})` : ''}: ${why}. Members are offered the letters inside Discord when VERIFY_TOKEN_SECRET is set. Set a public https VERIFY_BASE_URL.`); // i18n-ignore: operator log
}

/** `{ url, expiresAt }` (seconds) for this member, or `{ problem }`. */
function verifyLinkFor(userId, guildId) {
  const problem = linkProblem();
  if (problem) { warnOperator(problem, guildId); return { problem }; }
  return { url: `${baseUrl()}/verify/${createToken({ userId, guildId })}`, expiresAt: Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS };
}

/**
 * The letters inside Discord stand in for the link when the link cannot be given (VERIFY_BASE_URL missing or not a public address) and
 * the secret that signs the pictures is there: the member can still get in.
 */
const lettersInstead = (method) => usesLink(method) && Boolean(linkProblem()) && Boolean(config.verifyTokenSecret);
/** Whether the member can do the letters inside Discord in this server (its method, or in place of a link that cannot be given). */
const canDoLetters = (method) => inDiscord(method) || lettersInstead(method);

module.exports = { baseUrl, linkProblem, verifyLinkFor, warnOperator, lettersInstead, canDoLetters };
