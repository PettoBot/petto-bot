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
 * Checks a URL against Google Safe Browsing. Returns an array of matched threat
 * types (empty means clean). Throws if the key is missing or the API call fails.
 */
async function checkUrl(url) {
  if (!config.googleSafeBrowsingKey) {
    throw new Error('GOOGLE_SAFE_BROWSING_API_KEY is not configured.');
  }

  const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${config.googleSafeBrowsingKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  if (!res.ok) {
    throw new Error(`Safe Browsing API returned ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return (data.matches ?? []).map((match) => match.threatType);
}

module.exports = { checkUrl, normalizeUrl, extractUrls, defangUrl };
