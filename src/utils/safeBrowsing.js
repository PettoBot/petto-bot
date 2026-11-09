const config = require('../config');

const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'];
const URL_CANDIDATE_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Adds a scheme if missing and validates the result is a real HTTP(S) URL. */
function normalizeUrl(input) {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // Fragments are not sent to the remote server and should not create duplicate DB rows.
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** Extracts and normalizes HTTP(S) URLs from ordinary Discord message text. */
function extractUrls(text, limit = 10) {
  const matches = String(text ?? '').match(URL_CANDIDATE_RE) ?? [];
  const urls = [];

  for (const match of matches) {
    // Remove punctuation that commonly follows a URL in prose/Markdown.
    const candidate = match.replace(/[\],.!?;:)}]+$/g, '');
    const normalized = normalizeUrl(candidate);
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
    if (urls.length >= limit) break;
  }

  return urls;
}

/** Makes a URL non-clickable for security alerts/logs. */
function defangUrl(input) {
  return String(input ?? '')
    .replace(/^https:\/\//i, 'hxxps://')
    .replace(/^http:\/\//i, 'hxxp://')
    .replace(/\./g, '[.]');
}

/**
 * Checks a URL against Google Safe Browsing. Returns an array of matched threat types (empty means clean). Throws when there is no key or
 * the API call fails. `options.key` and `options.fetcher` let a test replace the key and the network.
 */
async function checkUrl(url, { key = config.googleSafeBrowsingKey, fetcher = fetch } = {}) {
  if (!key) throw new Error('GOOGLE_SAFE_BROWSING_API_KEY is not configured.'); // i18n-ignore: error for the logs of the bot team
  const res = await fetcher(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      client: { clientId: 'petto-bot', clientVersion: '1.0.0' },
      threatInfo: {
        threatTypes: THREAT_TYPES,
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url }],
      },
    }),
  });
  if (!res.ok) throw new Error(`Safe Browsing API returned ${res.status}`); // i18n-ignore: error for the logs of the bot team
  const data = await res.json();
  return [...new Set((data.matches ?? []).map((match) => match.threatType))];
}

module.exports = { checkUrl, normalizeUrl, extractUrls, defangUrl };
