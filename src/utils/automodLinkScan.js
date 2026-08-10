const { checkUrl, normalizeUrl } = require('./safeBrowsing');

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>'"]+/gi;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_MINUTE = 30;
const resultsCache = new Map();
const inFlight = new Map();
const requestTimes = [];

function extractFirstUrl(content) {
  const raw = String(content ?? '').match(URL_RE)?.[0];
  if (!raw) return null;
  return normalizeUrl(raw.replace(/[),.!?;:]+$/, ''));
}

/**
 * Checks at most one URL per message, with a short cache and a process-wide
 * request ceiling so enabling automatic scanning cannot hammer Safe Browsing.
 */
async function checkFirstMessageUrl(content) {
  const url = extractFirstUrl(content);
  if (!url) return null;

  const now = Date.now();
  const cached = resultsCache.get(url);
  if (cached && cached.expiresAt > now) return cached;
  if (cached) resultsCache.delete(url);
  if (inFlight.has(url)) return inFlight.get(url);

  while (requestTimes[0] && now - requestTimes[0] >= 60_000) requestTimes.shift();
  if (requestTimes.length >= MAX_REQUESTS_PER_MINUTE) return null;
  requestTimes.push(now);

  const promise = checkUrl(url)
    .then((threats) => {
      const result = { url, threats, expiresAt: Date.now() + CACHE_TTL_MS };
      resultsCache.set(url, result);
      if (resultsCache.size > 1000) resultsCache.delete(resultsCache.keys().next().value);
      return result;
    })
    .finally(() => inFlight.delete(url));

  inFlight.set(url, promise);
  return promise;
}

module.exports = { checkFirstMessageUrl };
