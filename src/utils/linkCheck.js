// i18n-ignore-file: internal logs of the link check
// The verdict of `!automod link`: a link Petto already knows is flagged (no call to Google), anything else is asked to Google Safe Browsing and,
// when Google flags it, kept so it is never asked again (and the message guard can remove it). `deps` lets a test replace the store and Google.
const safeBrowsing = require('./safeBrowsing');
const links = require('../db/maliciousLinks');
const logger = require('./logger');

/**
 * `{ state: 'flagged', threats, row, known }`, `{ state: 'clean' }` or `{ state: 'unavailable' }` (no key or Google did not answer).
 * `known` is true when the link was already stored; `row` is its row (null when it could not be saved).
 */
async function checkLink(url, { reportedBy = null, guildId = null, channelId = null } = {}, deps = {}) {
  const store = deps.links ?? links;
  const check = deps.checkUrl ?? safeBrowsing.checkUrl;

  let known = null;
  try {
    known = (await store.findKnownMalicious([url]))[0] ?? null;
  } catch (err) {
    // A database outage should not make the manual checker useless: Google is asked anyway.
    logger.error('Malicious-link DB lookup failed:', err);
  }
  if (known) return { state: 'flagged', threats: known.threat_types ?? [], row: known, known: true };

  let threats;
  try {
    threats = await check(url);
  } catch (err) {
    logger.error('Safe Browsing check failed:', err);
    return { state: 'unavailable' };
  }
  if (!threats.length) return { state: 'clean' };

  let row = null;
  try {
    row = await store.recordMaliciousLink({ url, threatTypes: threats, reportedBy, guildId, channelId });
  } catch (err) {
    logger.error('Failed to save malicious URL:', err);
  }
  return { state: 'flagged', threats, row, known: false };
}

module.exports = { checkLink };
