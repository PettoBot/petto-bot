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
 * External reputation APIs require accounts or keys, which Petto deliberately
 * does not require. Public feeds are synchronized by maliciousFeedJob and
 * checked locally by the command/event consumers instead.
 */
module.exports = { normalizeUrl, extractUrls, defangUrl };
