// What the feeds ask of the network: a text or a JSON with a time limit, a size limit and the name of the bot, and the failures told apart
// (`notFound`, `rateLimited`, `unavailable`) so a feed knows whether to try again or to say that the account is gone.
const { IntegrationError, USER_AGENT, whyNoAnswer, withOneRetry } = require('../utils/integrations');

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;

const MAX_RETRY_AFTER_MS = 60_000;
/** The wait a `Retry-After` header asks for (seconds, or a date), in ms and at most a minute; 0 when there is none. */
function retryAfterOf(value) {
  if (!value) return 0;
  const ms = /^\d+$/.test(String(value).trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : 0;
}

/** `timeoutMs` is the time of one attempt; `retry: false` leaves the second attempt to the caller (it has other addresses to try). A `User-Agent` in `headers` replaces the default. */
async function request(url, { headers = {}, method = 'GET', body, timeoutMs = TIMEOUT_MS, retry = true } = {}) {
  let response;
  const send = () => globalThis.fetch(url, { method, body, headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  try {
    response = await (retry ? withOneRetry(send) : send());
  } catch (error) {
    throw new IntegrationError('unavailable', whyNoAnswer(error)); // the log says why: "timeout", ENOTFOUND, ECONNRESET...
  }
  if (response.status === 404 || response.status === 410) throw new IntegrationError('notFound');
  if (response.status === 429) throw Object.assign(new IntegrationError('rateLimited'), { retryAfterMs: retryAfterOf(response.headers?.get?.('retry-after')) });
  if (!response.ok) throw Object.assign(new IntegrationError('unavailable', String(response.status)), { status: response.status }); // `status`: a caller can tell a refusal (403) from a failure (5xx)
  return response;
}

async function readText(response) {
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new IntegrationError('unavailable', 'too big'); // i18n-ignore: internal detail of an error, never shown
  return text;
}

/** A text (an XML feed, a page). */
async function fetchText(url, options) {
  return readText(await request(url, { ...options, headers: { Accept: 'application/xml, text/xml, text/html, */*', ...options?.headers } })); // i18n-ignore: a header sent to the services
}

/** A JSON answer. */
async function fetchJsonBody(url, options) {
  const text = await readText(await request(url, { ...options, headers: { Accept: 'application/json', ...options?.headers } }));
  try {
    return JSON.parse(text);
  } catch {
    throw new IntegrationError('unavailable', 'not json'); // i18n-ignore: internal detail of an error, never shown
  }
}

module.exports = { fetchText, fetchJsonBody };

// ---- Links a person typed (an RSS feed of any site): the address must be public, so a feed cannot be used to reach the bot's own network ----
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { isPrivateAddress, safeLookup } = require('../utils/safeImage');

const MAX_REDIRECTS = 3;

/** The link as a URL when it is http(s), on the standard port and not an address of a private network; otherwise null. */
function publicUrl(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (net.isIP(host) && isPrivateAddress(host)) return null;
  return url;
}

function getOnce(url) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { method: 'GET', lookup: safeLookup, timeout: TIMEOUT_MS, headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' } }, (res) => { // i18n-ignore: a header sent to the sites
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); resolve({ redirect: new URL(res.headers.location, url).toString() }); return; }
      if (status === 404 || status === 410) { res.resume(); reject(new IntegrationError('notFound')); return; }
      if (status === 429) { res.resume(); reject(new IntegrationError('rateLimited')); return; }
      if (status !== 200) { res.resume(); reject(new IntegrationError('unavailable', String(status))); return; }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size > MAX_BYTES) req.destroy(new IntegrationError('unavailable', 'too big')); else chunks.push(chunk); }); // i18n-ignore: internal detail of an error, never shown
      res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), url: url.toString() }));
      res.on('error', () => reject(new IntegrationError('unavailable')));
    });
    req.on('timeout', () => req.destroy(new IntegrationError('unavailable', 'timeout'))); // i18n-ignore: internal detail of an error, never shown
    const deadline = setTimeout(() => req.destroy(new IntegrationError('unavailable', 'too slow')), 3 * TIMEOUT_MS); // a site that answers a drop at a time // i18n-ignore: internal detail of an error, never shown
    req.on('close', () => clearTimeout(deadline));
    req.on('error', (error) => reject(error instanceof IntegrationError ? error : new IntegrationError('unavailable')));
    req.end();
  });
}

/** A text from a link a person typed: only public addresses (checked again at each redirect and at the connection), with a time and a size limit. Answers `{ text, url }`. */
async function fetchPublicText(link) {
  let url = publicUrl(link);
  if (!url) throw new IntegrationError('badInput');
  for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
    const answer = await getOnce(url);
    if (!answer.redirect) return answer;
    url = publicUrl(answer.redirect);
    if (!url) throw new IntegrationError('badInput');
  }
  throw new IntegrationError('unavailable', 'redirects'); // i18n-ignore: internal detail of an error, never shown
}

module.exports.publicUrl = publicUrl;
module.exports.fetchPublicText = fetchPublicText;
