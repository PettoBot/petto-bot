// Kick: who is live. Kick's public API (the app of the bot, KICK_CLIENT_ID and KICK_CLIENT_SECRET) tells the channels and their stream, up to 50
// accounts in one call. A channel has no id for each stream: the moment it started is what tells one stream from the next.
// Kick sometimes refuses (403, a Cloudflare page instead of JSON), limits (429) or fails, so a channel is read from several addresses in order: the public API
// (when the bot has its keys), then the web endpoints of kick.com (`/api/v2/channels/<slug>`, `/api/v1/channels/<slug>`), which answer the same live state
// without keys. Every answer becomes the shape of the public API, so nothing after this file knows where it came from. A fallback is tried only on a 401/403, 429,
// 5xx, network error, timeout or an answer that is not the expected JSON, never on a 404 (the channel does not exist).
const config = require('../../config');
const { fetchJsonBody } = require('../http');
const { IntegrationError, USER_AGENT } = require('../../utils/integrations');
const logger = require('../../utils/logger');
const { imageReady } = require('../picture');

const API = 'https://api.kick.com/public/v1';
const TOKEN_URL = 'https://id.kick.com/oauth/token';
const WEB = 'https://kick.com/api';
const SLUG = /^[\w-]{1,25}$/;
const BATCH = 50;
const ATTEMPT_MS = 5_000; // one address
const TOTAL_MS = 12_000; // the whole read of one channel, every address together
const POLL_WEB_MS = 60_000; // the reads of many channels one by one (the public API failed), under the 90 seconds the job gives a platform
const KEEP_MS = 2 * 60_000; // a read is reused this long (the dashboard looks the account up, then creates the feed)
const CACHE_LIMIT = 300;
// The plain User-Agent of the bot (`Petto-Discord-Bot/1.0 (+https://petto.sbs)`) is what Kick gets first. Only when an address refuses it (403 or a page that is
// not JSON) the same address is asked once more with a browser-like User-Agent that still names the bot and its site; it is remembered for ten minutes.
const BROWSER_USER_AGENT = `Mozilla/5.0 (compatible; ${USER_AGENT.replace(' (+', '; +')} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36`; // i18n-ignore: sent to Kick, never shown
const BROWSER_UA_KEEP_MS = 10 * 60_000;

let token = null;
let pending = null;
const hasKeys = () => Boolean(config.kickClientId && config.kickClientSecret);

/** The slug (the name in the link) from a name, `@name` or a link. */
function parseSlug(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.|m\.)?kick\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return SLUG.test(text) ? text.toLowerCase() : null;
}

async function appToken(force = false, timeoutMs = ATTEMPT_MS) {
  if (!hasKeys()) throw new IntegrationError('notConfigured');
  if (!force && token && token.until > Date.now()) return token.value;
  pending ??= fetchJsonBody(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutMs, retry: false,
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.kickClientId, client_secret: config.kickClientSecret }).toString(),
  }).then((body) => {
    if (!body?.access_token) throw new IntegrationError('unavailable', 'no token'); // i18n-ignore: internal detail of an error, never shown
    token = { value: body.access_token, until: Date.now() + Math.max(60, (Number(body.expires_in) || 3600) - 60) * 1000 };
    return token.value;
  }).finally(() => { pending = null; });
  return pending;
}

/** A call of the public API; `data` must be a list (anything else is a page that is not the API). */
async function api(path, timeoutMs = ATTEMPT_MS) {
  const ask = async () => {
    const body = await fetchJsonBody(`${API}${path}`, { headers: { Authorization: `Bearer ${await appToken(false, timeoutMs)}` }, timeoutMs, retry: false });
    if (!Array.isArray(body?.data)) throw new IntegrationError('unavailable', 'not json'); // i18n-ignore: internal detail of an error, never shown
    return body;
  };
  try {
    return await ask();
  } catch (error) {
    if (error.status === 401) { await appToken(true, timeoutMs); return ask(); } // the token ran out early
    throw error;
  }
}

const query = (key, values) => values.map((value) => `${key}=${encodeURIComponent(value)}`).join('&');

// ---- The web endpoints of kick.com: the same channel and stream in another shape ----

/** When a stream started, as the ISO text the public API uses (`2026-10-26T20:00:00Z`), so one stream has one id from every address. The web says `2026-10-26 20:00:00` (UTC). */
function isoStart(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]00:?00)?$/.exec(text);
  return match ? `${match[1]}T${match[2]}Z` : text;
}

const httpsUrl = (value) => (/^https:\/\//i.test(value ?? '') ? String(value) : '');

/**
 * The answer of `/api/v2/channels/<slug>` or `/api/v1/channels/<slug>` as `{ channel, id, name, avatar }`, with `channel` in the shape of the public API
 * (`broadcaster_user_id`, `slug`, `stream_title`, `category`, `stream`). `livestream` is null when the channel is offline. Anything that is not a channel
 * (a block page that answers 200 with JSON, a list) fails as `unavailable`, so the next address is tried.
 */
function parseWebChannel(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.slug || body.user_id == null) throw new IntegrationError('unavailable', 'not a channel'); // i18n-ignore: internal detail of an error, never shown
  const live = body.livestream && typeof body.livestream === 'object' && body.livestream.is_live !== false ? body.livestream : null;
  const picture = live?.thumbnail;
  const channel = { broadcaster_user_id: body.user_id, slug: String(body.slug), stream_title: live ? String(live.session_title ?? '') : '', stream: { is_live: false } };
  if (live) {
    const category = live.categories?.[0]?.name ?? live.category?.name;
    if (category) channel.category = { name: String(category) };
    channel.stream = {
      is_live: true, start_time: isoStart(live.start_time ?? live.created_at), viewer_count: Number(live.viewer_count ?? live.viewers) || 0,
      thumbnail: httpsUrl(typeof picture === 'string' ? picture : picture?.src ?? picture?.url),
    };
  }
  return { channel, id: String(body.user_id), name: String(body.user?.username || body.slug), avatar: httpsUrl(body.user?.profile_pic) || null };
}

const browserUa = { until: 0 };
/** Whether an error is a refusal of the address (403, or a page that is not what it should be), as opposed to a failure (5xx, no answer) or a limit (429). */
const refusedBy = (error) => error.kind === 'unavailable' && (error.status === 403 || /not json|not a channel/.test(error.message)); // i18n-ignore: internal detail of an error

/** One web address. Asks with the plain User-Agent and, only if the address refuses it, once more with the browser-like one. */
async function readWeb(slug, version, timeoutMs) {
  const url = `${WEB}/${version}/channels/${encodeURIComponent(slug)}`;
  const started = Date.now();
  const ask = (headers, ms) => fetchJsonBody(url, { headers, timeoutMs: ms, retry: false }).then(parseWebChannel);
  if (browserUa.until > Date.now()) return ask({ 'User-Agent': BROWSER_USER_AGENT }, timeoutMs);
  try {
    return await ask({}, timeoutMs);
  } catch (error) {
    const left = timeoutMs - (Date.now() - started);
    if (!(error instanceof IntegrationError) || !refusedBy(error) || left < 1000) throw error;
    logger.info(`feed kick ${slug}: kick.com/api/${version} ${whyFailed(error)}, asking again with a browser-like User-Agent`); // i18n-ignore: a line of the log
    const channel = await ask({ 'User-Agent': BROWSER_USER_AGENT }, left);
    browserUa.until = Date.now() + BROWSER_UA_KEEP_MS;
    return channel;
  }
}

/** The channel and its stream from the public API, as `{ channel, id, name, avatar }`. */
async function readOfficial(slug, timeoutMs) {
  const started = Date.now();
  const channel = (await api(`/channels?${query('slug', [slug])}`, timeoutMs)).data[0];
  if (!channel) throw new IntegrationError('notFound');
  let user = null;
  if (timeoutMs - (Date.now() - started) >= 500) {
    try { user = (await api(`/users?${query('id', [channel.broadcaster_user_id])}`, timeoutMs - (Date.now() - started))).data[0] ?? null; } catch { /* the picture is only decoration */ }
  }
  return { channel, id: String(channel.broadcaster_user_id), name: user?.name || channel.slug, avatar: user?.profile_picture ?? null };
}

/** The addresses to read a channel from, in the order they are tried. `families` limits them (`['web']` when the public API just failed for a whole batch). */
function channelSources(slug, families = ['official', 'web']) {
  const sources = [];
  if (families.includes('official') && hasKeys()) sources.push({ host: 'api.kick.com', family: 'official', read: (ms) => readOfficial(slug, ms) });
  if (families.includes('web')) for (const version of ['v2', 'v1']) sources.push({ host: `kick.com/api/${version}`, family: 'web', read: (ms) => readWeb(slug, version, ms) }); // i18n-ignore: a name for the log
  return sources;
}

/** Why an attempt failed, for the log: the status (with the wait Kick asked for) or the word the network gave. */
function whyFailed(error) {
  if (error.kind === 'rateLimited') return error.retryAfterMs ? `429 (retry-after ${Math.round(error.retryAfterMs / 1000)}s)` : '429'; // i18n-ignore: a word for the log
  return String(error.status ?? (error.message.replace(/^unavailable: ?/, '') || 'no answer')); // i18n-ignore: a word for the log
}

const retryable = (error) => error.kind === 'rateLimited' || (error.kind === 'unavailable' && (error.status === undefined || error.status === 401 || error.status === 403 || error.status >= 500));

// The requests to kick.com share one small queue (one every `gapMs`), and when Kick says how long to wait (`Retry-After`, at most a minute) nothing is sent to
// that family of addresses until then. The public API and the web endpoints are different servers, each with its own wait.
const pace = { gapMs: 400, lastAt: 0, queue: Promise.resolve(), cool: { official: 0, web: 0 } }; // exported for the checks
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function takeTurn() {
  const turn = pace.queue.then(async () => {
    const wait = pace.lastAt + pace.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    pace.lastAt = Date.now();
  });
  pace.queue = turn;
  return turn;
}

/**
 * Reads a channel now, address by address. A 404 (the channel does not exist) stops the reading. Answers `{ channel, id, name, avatar }`; otherwise fails
 * with `rateLimited` (some address said 429; `retryAfterMs` is what Kick asked for), `blocked` (403, or a page that is not JSON) or `unavailable`. Each
 * attempt has its own time and the reading gives up in about 12 seconds from its first request.
 */
async function readNow(slug, families) {
  const sources = channelSources(slug, families);
  let deadline = null;
  let refused = false;
  let limited = false;
  let retryAfterMs = 0;
  let last = 'no time'; // i18n-ignore: a word for the log
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    if (pace.cool[source.family] > Date.now()) { limited = true; retryAfterMs = Math.max(retryAfterMs, pace.cool[source.family] - Date.now()); last = '429 (waiting)'; continue; } // i18n-ignore: a word for the log
    if (source.family === 'web') await takeTurn();
    deadline ??= Date.now() + TOTAL_MS;
    const left = deadline - Date.now();
    if (left < 1000) break;
    try {
      return await source.read(Math.min(ATTEMPT_MS, left));
    } catch (error) {
      if (!(error instanceof IntegrationError) || error.kind === 'notFound' || !retryable(error)) throw error;
      if (error.kind === 'rateLimited') {
        limited = true; retryAfterMs = Math.max(retryAfterMs, error.retryAfterMs ?? 0);
        if (error.retryAfterMs) pace.cool[source.family] = Date.now() + error.retryAfterMs;
      } else if (refusedBy(error)) refused = true;
      last = whyFailed(error);
      const next = sources[i + 1];
      logger.info(`feed kick ${slug}: ${source.host} ${last}, ${next && deadline - Date.now() >= 1000 ? `trying ${next.host}` : 'giving up'}`); // i18n-ignore: a line of the log
    }
  }
  throw Object.assign(new IntegrationError(limited ? 'rateLimited' : refused ? 'blocked' : 'unavailable', last), { retryAfterMs });
}

const reads = new Map(); // slug -> { until, promise }

/**
 * A channel with its stream. What was read is kept two minutes (and a reading in progress is shared), so looking an account up and then following it asks
 * Kick once. The polling job passes `fresh` to always read anew; what it reads is kept too.
 */
function readChannel(slug, { fresh = false, families } = {}) {
  const kept = reads.get(slug);
  if (!fresh && kept && kept.until > Date.now()) return kept.promise;
  if (reads.size >= CACHE_LIMIT) reads.delete(reads.keys().next().value);
  const entry = { until: Infinity, promise: null };
  entry.promise = readNow(slug, families).then((read) => { entry.until = Date.now() + KEEP_MS; return read; }, (error) => { if (reads.get(slug) === entry) reads.delete(slug); throw error; });
  reads.set(slug, entry);
  return entry.promise;
}

const forget = () => { reads.clear(); pace.cool.official = 0; pace.cool.web = 0; pace.lastAt = 0; browserUa.until = 0; token = null; pending = null; }; // for the checks

/** The account a person pointed at: its id is the id of the broadcaster, its picture comes from the user of that id. */
async function resolveChannel(input) {
  const slug = parseSlug(input);
  if (!slug) throw new IntegrationError('badInput');
  const { channel, id, name, avatar } = await readChannel(slug);
  return { id, slug: channel.slug, name, avatar, url: `https://kick.com/${channel.slug}` };
}

/** The channel of an account (`{ id, url }`) when it is live now, or null. Used when a feed is made, so it shares the read of the lookup. */
async function liveChannel(account) {
  const slug = parseSlug(account.url);
  if (!slug) throw new IntegrationError('unavailable', 'no slug'); // i18n-ignore: internal detail of an error, never shown
  const { channel } = await readChannel(slug);
  return channel.stream?.is_live ? channel : null;
}

/**
 * The channels that are live now among some accounts (`{ id, url }`; a bare id works for the public API only): `{ live: { [broadcasterId]: channel }, failed:
 * { [broadcasterId]: error } }`. The public API is asked first, 50 accounts in each call; the accounts of a call that failed (and every account when the bot
 * has no keys) are read one by one from the web endpoints, and a run of failures stops it early: the rest would fail the same way. An account that failed is
 * not offline: the caller must not close its notice.
 */
async function liveChannels(accounts) {
  const list = accounts.map((account) => (typeof account === 'object' ? { id: String(account.id), slug: parseSlug(account.url) } : { id: String(account), slug: null }));
  const live = {};
  const failed = {};
  let rest = list;
  if (hasKeys()) {
    rest = [];
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      if (pace.cool.official > Date.now()) { rest.push(...batch); continue; }
      try {
        for (const channel of (await api(`/channels?${query('broadcaster_user_id', batch.map((account) => account.id))}`)).data) {
          if (channel.stream?.is_live) live[String(channel.broadcaster_user_id)] = channel;
        }
      } catch (error) {
        if (!(error instanceof IntegrationError) || !retryable(error)) { for (const account of batch) failed[account.id] = error; continue; }
        if (error.kind === 'rateLimited' && error.retryAfterMs) pace.cool.official = Date.now() + error.retryAfterMs;
        logger.info(`feed kick: api.kick.com ${whyFailed(error)} for ${batch.length} account(s), trying kick.com/api`); // i18n-ignore: a line of the log
        rest.push(...batch);
      }
    }
  }
  const deadline = Date.now() + POLL_WEB_MS;
  let run = 0;
  let lastError = null;
  for (const account of rest) {
    if (!account.slug) { failed[account.id] = new IntegrationError('unavailable', 'no slug'); continue; } // i18n-ignore: internal detail of an error, never shown
    if ((run >= 3 && lastError) || Date.now() >= deadline) { failed[account.id] = lastError ?? new IntegrationError('unavailable', 'no time'); continue; } // i18n-ignore: internal detail of an error, never shown
    try {
      const { channel } = await readChannel(account.slug, { fresh: true, families: ['web'] });
      run = 0;
      if (channel.stream?.is_live) live[account.id] = channel;
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      failed[account.id] = error;
      if (error.kind === 'notFound') continue;
      run += 1; lastError = error;
    }
  }
  return { live, failed };
}

/** The id of a stream: when it started. */
const streamId = (channel) => String(channel.stream?.start_time ?? '');

/** The card item of a live stream. `account` is what `resolveChannel` gave when the feed was made. */
function toItem(channel, account = {}) {
  const viewers = Number(channel.stream?.viewer_count) || 0;
  const category = channel.category?.name;
  const thumbnail = String(channel.stream?.thumbnail ?? '');
  return {
    platform: 'kick', type: 'live', viewers, id: streamId(channel), title: channel.stream_title || account.name || channel.slug, url: `https://kick.com/${channel.slug}`,
    description: '', image: /^https:\/\//i.test(thumbnail) ? thumbnail : null, avatar: account.avatar ?? null, author: account.name || channel.slug,
    authorUrl: `https://kick.com/${channel.slug}`, publishedAt: Date.parse(channel.stream?.start_time) || null,
    extra: [category ? `🎮 ${category}` : null, viewers ? `👁 ${viewers.toLocaleString('en-US')}` : null].filter(Boolean).join(' · '),
  };
}

module.exports = { parseSlug, resolveChannel, liveChannel, liveChannels, streamId, toItem, imageReady, parseWebChannel, forget, pace, BROWSER_USER_AGENT };
