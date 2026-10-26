// What the feeds ask of the network: a text or a JSON with a time limit, a size limit and the name of the bot, and the failures told apart
// (`notFound`, `rateLimited`, `unavailable`) so a feed knows whether to try again or to say that the account is gone.
const { IntegrationError, USER_AGENT } = require('../utils/integrations');

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;

async function request(url, { headers = {}, method = 'GET', body } = {}) {
  let response;
  try {
    response = await globalThis.fetch(url, { method, body, headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  } catch {
    throw new IntegrationError('unavailable');
  }
  if (response.status === 404 || response.status === 410) throw new IntegrationError('notFound');
  if (response.status === 429) throw new IntegrationError('rateLimited');
  if (!response.ok) throw new IntegrationError('unavailable', String(response.status));
  return response;
}

async function readText(response) {
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new IntegrationError('unavailable', 'too big');
  return text;
}

/** A text (an XML feed, a page). */
async function fetchText(url, options) {
  return readText(await request(url, { ...options, headers: { Accept: 'application/xml, text/xml, text/html, */*', ...options?.headers } }));
}

/** A JSON answer. */
async function fetchJsonBody(url, options) {
  const text = await readText(await request(url, { ...options, headers: { Accept: 'application/json', ...options?.headers } }));
  try {
    return JSON.parse(text);
  } catch {
    throw new IntegrationError('unavailable', 'not json');
  }
}

module.exports = { fetchText, fetchJsonBody };
