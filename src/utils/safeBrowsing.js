const config = require('../config');

const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'];

/** Adds a scheme if missing and validates the result is a real URL. Returns null if unparseable. */
function normalizeUrl(input) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`).toString();
  } catch {
    return null;
  }
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

function isSafeBrowsingConfigured() {
  return Boolean(config.googleSafeBrowsingKey);
}

module.exports = { checkUrl, normalizeUrl, isSafeBrowsingConfigured };
