// Feeds that are read as RSS or Atom: any blog or news site (`rss`), a subreddit (`reddit`) and a Pinterest profile or board (`pinterest`).
// A feed of a site a person typed is fetched only from public addresses (see `fetchPublicText`).
const { fetchText, fetchJsonBody, fetchPublicText, publicUrl } = require('../http');
const { parseFeed, discoverFeed, decode, clean } = require('../feedparse');
const { clip } = require('../text');
const { IntegrationError, USER_AGENT } = require('../../utils/integrations');
const logger = require('../../utils/logger');
const { version: PETTO_VERSION } = require('../../../package.json');

const REDDIT = /^[A-Za-z0-9_]{2,21}$/;
const PINTEREST = /^[\w.\-]{3,30}$/;
// The name of a board is its address: it can hold letters of other alphabets, written as %XX in a link.
const PINTEREST_BOARD = /^[\w.\-%]{1,200}$/;

/** The account of a generic feed is its address, without the fragment and with the host in lower case. */
function normalizeUrl(input) {
  let text = String(input ?? '').trim();
  if (text && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  const url = publicUrl(text);
  if (!url) return null;
  url.hash = '';
  return url.toString().slice(0, 300);
}

/** Where sites usually keep their feed when a page does not announce it: next to the page (`/changelog/rss.xml`), then at the root. */
function usualFeedUrls(pageUrl) {
  let url;
  try { url = new URL(pageUrl); } catch { return []; }
  const path = url.pathname.replace(/\/+$/, '');
  const names = ['rss.xml', 'feed.xml', 'atom.xml', 'feed', 'rss'];
  const bases = [...new Set([path ? `${path}/` : null, path ? `${path}.` : null, '/'].filter(Boolean))];
  const out = [];
  for (const base of bases) {
    if (base.endsWith('.')) { out.push(`${url.origin}${base}xml`, `${url.origin}${base}rss`); continue; }
    for (const name of names) out.push(`${url.origin}${base}${name}`);
  }
  return [...new Set(out)].slice(0, 10);
}

/** The first of the links that is a feed, as `{ answer, feed }`, or null. */
async function firstFeed(links) {
  for (const link of links) {
    const url = normalizeUrl(link);
    if (!url) continue;
    const answer = await fetchPublicText(url).catch(() => null);
    const feed = answer ? parseFeed(answer.text) : null;
    if (feed?.isFeed) return { answer, feed };
  }
  return null;
}

/** The feed at the address of an `rss` account. A page that is not (or no longer) a feed is an error the feed list shows, not an empty feed. */
async function readRss(url, max) {
  const feed = parseFeed((await fetchPublicText(url)).text, { max });
  if (!feed.isFeed) throw new IntegrationError('noFeed');
  return feed;
}

async function resolveRss(input) {
  const start = normalizeUrl(input);
  if (!start) throw new IntegrationError('badInput');
  let answer = await fetchPublicText(start);
  let feed = parseFeed(answer.text);
  if (!feed.isFeed) {
    // A page of a site: its feed is announced in the page, or kept where sites usually keep it. A page with neither is said to have no feed
    // (it was taken for an empty feed before, which never posted).
    const found = discoverFeed(answer.text, answer.url);
    const hit = await firstFeed([...(found ? [found] : []), ...usualFeedUrls(answer.url)]);
    if (!hit) throw new IntegrationError('noFeed');
    ({ answer, feed } = hit);
  }
  const site = publicUrl(feed.link) ?? publicUrl(answer.url);
  const favicon = site ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site.hostname)}&sz=128` : null;
  return { id: normalizeUrl(answer.url), name: feed.title || site?.hostname || 'RSS', avatar: feed.image || favicon, url: site?.toString() ?? answer.url };
}

// The words of the card header are the account (`source`: a subreddit, a board, a blog), what is below it is the post; the card never repeats the account in the byline.
const baseItem = (platform, type, entry, account) => ({
  platform, type, id: entry.id, title: entry.title || account.name, url: entry.url || account.url, description: entry.summary, image: entry.image || null, avatar: account.avatar ?? null,
  author: account.name, authorUrl: account.url, source: account.name, sourceUrl: account.url, publishedAt: entry.published, extra: '',
});

// --- Reddit: what the feed of a subreddit says about a post, without the boilerplate Reddit adds to every entry --------------------------------------------------
const REDDIT_BOILERPLATE = /(?:\s|&#32;)*submitted(?:\s|&#32;)+by(?:\s|&#32;)+(?=<a\b|\/?u\/)/gi; // `submitted by /u/name [link] [comments]`, at the end of the text of every entry
const REDDIT_PICTURE_HOSTS = /^https:\/\/(?:i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|i\.imgur\.com)\//i;
const REDDIT_THUMBNAIL = /^https:\/\/(?:[a-z]\.)?thumbs\.redditmedia\.com\//i; // 140 pixels: never shown beside (or instead of) the real picture
const PICTURE_FILE = /\.(?:jpe?g|png|gif|webp)(?:\?|$)/i;

/** The text of a post (a text post), with what Reddit appends (`submitted by`, `[link]`, `[comments]`) cut off. */
function redditText(entry) {
  const html = entry.html ?? '';
  if (!html) return String(entry.summary ?? '').replace(/\s*submitted by\s*\/?u\/\S+.*$/i, '').replace(/\[(?:link|comments?)\]/gi, '').trim();
  let cut = html.length;
  for (const match of html.matchAll(REDDIT_BOILERPLATE)) cut = match.index; // the last one: the post may say "submitted by" itself
  return clean(html.slice(0, cut), 400).replace(/\[(?:link|comments?)\]/gi, '').trim();
}

/** The best picture of a post: the file it links to when that is a picture, else the preview in its text; never the small thumbnail. */
function redditPicture(entry) {
  const html = entry.html ?? '';
  const direct = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"[^>]*>\s*\[link\]/gi)].map((m) => decode(m[1])).find((href) => REDDIT_PICTURE_HOSTS.test(href) && PICTURE_FILE.test(href));
  if (direct) return direct;
  const inText = /<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/i.exec(html)?.[1];
  const candidates = [inText ? decode(inText) : '', entry.image];
  return candidates.find((url) => /^https:\/\//i.test(url ?? '') && !REDDIT_THUMBNAIL.test(url)) ?? '';
}

/** `u/name` and the link of the profile from what the feed gives (`/u/name`), or empty. */
function redditAuthor(entry) {
  const name = /^\/?(?:u\/)?([\w-]{3,20})$/.exec(String(entry.author ?? '').trim())?.[1];
  return name ? { author: `u/${name}`, authorUrl: `https://www.reddit.com/user/${name}` } : { author: '', authorUrl: null };
}

function toItem(platform, type, entry, account) {
  const item = baseItem(platform, type, entry, account);
  if (platform === 'reddit') return { ...item, description: redditText(entry), image: redditPicture(entry) || null, ...redditAuthor(entry) };
  if (platform === 'pinterest') return pinterestItem(item, entry, account);
  return item;
}

/** The reddit name from `r/name`, `/r/name`, a link to the subreddit or a post, or just the name. */
function parseSubreddit(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.|old\.|new\.)?reddit\.com/i, '').replace(/^\/?r\//i, '').split(/[/?#]/)[0];
  return REDDIT.test(text) ? text : null;
}

// Reddit asks for a descriptive User-Agent (`platform:app-id:version (by /u/username)`) and refuses the generic ones of shared hosts more often.
// There is no Reddit account to name, so the contact of the project's own User-Agent goes where the username would.
const REDDIT_USER_AGENT = `nodejs:petto-discord-bot:v${PETTO_VERSION} ${/\(.*\)\s*$/.exec(USER_AGENT)?.[0] ?? '(+https://petto.sbs)'}`; // i18n-ignore: sent to Reddit, never shown
const REDDIT_ATTEMPT_MS = 5_000; // one address
const REDDIT_TOTAL_MS = 12_000; // the whole read, every address together
const REDDIT_KEEP_MS = 2 * 60_000; // a read is reused this long (the dashboard looks the account up, then creates the feed)
const REDDIT_CACHE_LIMIT = 300;

/** A real picture address from the list of a subreddit (`thumbnail` is also `self`, `default`, `nsfw`, `spoiler`...). */
const pictureUrl = (value) => (/^https:\/\//i.test(value ?? '') ? String(value) : '');
const oneLine = (value, max) => clip(String(value ?? '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(), max);

/**
 * The listing of `/r/<name>/new.json` as the same feed `parseFeed` gives for the RSS: `{ isFeed, title, link, image, entries }`, with the same ids (`t3_...`)
 * so what a feed marked as seen from one address is still seen from the other. A listing of subreddits (what Reddit answers for a name that does not
 * exist) is `notFound`.
 */
function parseRedditJson(body, name, max = 15) {
  const children = body?.data?.children;
  if (!Array.isArray(children)) throw new IntegrationError('unavailable', 'not a listing'); // i18n-ignore: internal detail of an error, never shown
  if (children[0]?.kind === 't5') throw new IntegrationError('notFound');
  const entries = children.filter((child) => child?.kind === 't3' && child.data).slice(0, max).map(({ data }) => {
    const preview = pictureUrl(data.preview?.images?.[0]?.source?.url);
    const direct = pictureUrl(data.url_overridden_by_dest ?? data.url);
    return {
      id: String(data.name || (data.id ? `t3_${data.id}` : '')).slice(0, 300), title: oneLine(data.title, 250),
      url: data.permalink ? `https://www.reddit.com${data.permalink}` : '', summary: oneLine(data.selftext, 400),
      image: preview || pictureUrl(data.thumbnail) || (/\.(?:jpe?g|png|gif|webp)(?:\?|$)/i.test(direct) ? direct : ''),
      published: Number(data.created_utc) ? Math.round(Number(data.created_utc) * 1000) : null, author: data.author ? `/u/${String(data.author).slice(0, 40)}` : '',
    };
  }).filter((entry) => entry.id && (entry.title || entry.url));
  return { isFeed: true, title: `r/${name}`, link: `https://www.reddit.com/r/${name}`, image: '', entries };
}

/** The addresses to read a subreddit from, in the order they are tried. */
function redditSources(name) {
  const path = encodeURIComponent(name);
  const headers = { 'User-Agent': REDDIT_USER_AGENT };
  const rssSource = (host) => ({
    host,
    async read(timeoutMs) {
      const feed = parseFeed(await fetchText(`https://${host}/r/${path}/new/.rss`, { headers, timeoutMs, retry: false }), { max: 15 });
      if (!feed.isFeed) throw new IntegrationError('unavailable', 'not a feed'); // a block page that answers 200 // i18n-ignore: internal detail of an error, never shown
      return feed;
    },
  });
  return [
    rssSource('www.reddit.com'),
    rssSource('old.reddit.com'),
    { host: 'www.reddit.com (json)', async read(timeoutMs) { return parseRedditJson(await fetchJsonBody(`https://www.reddit.com/r/${path}/new.json?limit=15&raw_json=1`, { headers, timeoutMs, retry: false }), name); } }, // i18n-ignore: a name for the log
  ];
}

/** Why an attempt failed, for the log: the status (with the wait Reddit asked for) or the word the network gave. */
function whyFailed(error) {
  if (error.kind === 'rateLimited') return error.retryAfterMs ? `429 (retry-after ${Math.round(error.retryAfterMs / 1000)}s)` : '429'; // i18n-ignore: a word for the log
  return String(error.status ?? (error.message.replace(/^unavailable: ?/, '') || 'no answer')); // i18n-ignore: a word for the log
}

// Every Reddit feed of the bot shares one small queue: a request is sent at most once for each `gapMs` (the limit can be for each address, so the
// next address is tried after the same gap). When Reddit says how long to wait (`Retry-After`, at most a minute), nothing is sent until then.
const redditPace = { gapMs: 2000, lastAt: 0, queue: Promise.resolve(), coolUntil: 0 }; // exported for the checks
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function takeRedditTurn() {
  const turn = redditPace.queue.then(async () => {
    const wait = redditPace.lastAt + redditPace.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    redditPace.lastAt = Date.now();
  });
  redditPace.queue = turn;
  return turn;
}

/**
 * Reads a subreddit now: the main address first and, when it is refused (403), limited (429), fails (5xx) or does not answer, the next ones (after the
 * gap of the queue). A 404 keeps its meaning and stops the reading. Answers `{ isFeed, title, image, entries }`; otherwise fails with `rateLimited` (some
 * address said 429; `retryAfterMs` is what Reddit asked for), `blocked` (403, or a page that is not a feed) or `unavailable`. Each attempt has its own
 * time, and the reading gives up in about 12 seconds from its first request.
 */
async function readRedditNow(name) {
  if (redditPace.coolUntil > Date.now()) throw Object.assign(new IntegrationError('rateLimited', 'waiting'), { retryAfterMs: redditPace.coolUntil - Date.now() }); // i18n-ignore: internal detail of an error, never shown
  const sources = redditSources(name);
  let deadline = null;
  let refused = false;
  let limited = false;
  let retryAfterMs = 0;
  let last = 'no time'; // i18n-ignore: a word for the log
  for (let i = 0; i < sources.length; i += 1) {
    await takeRedditTurn();
    deadline ??= Date.now() + REDDIT_TOTAL_MS;
    const left = deadline - Date.now();
    if (left < 1000) break;
    try {
      return await sources[i].read(Math.min(REDDIT_ATTEMPT_MS, left));
    } catch (error) {
      if (!(error instanceof IntegrationError) || error.kind === 'notFound') throw error;
      const retryable = error.kind === 'rateLimited' || (error.kind === 'unavailable' && (error.status === undefined || error.status === 403 || error.status >= 500));
      if (!retryable) throw error;
      if (error.kind === 'rateLimited') { limited = true; retryAfterMs = Math.max(retryAfterMs, error.retryAfterMs ?? 0); }
      else if (error.status === 403 || /not a feed/.test(error.message)) refused = true; // i18n-ignore: internal detail of an error
      last = whyFailed(error);
      const next = sources[i + 1];
      logger.info(`feed reddit r/${name}: ${sources[i].host} ${last}, ${next && deadline - Date.now() >= 1000 ? `trying ${next.host}` : 'giving up'}`); // i18n-ignore: a line of the log
    }
  }
  if (limited && retryAfterMs) {
    redditPace.coolUntil = Date.now() + retryAfterMs;
    logger.info(`feed reddit: Reddit asked to wait ${Math.round(retryAfterMs / 1000)}s, no request is sent until then`); // i18n-ignore: a line of the log
  }
  throw Object.assign(new IntegrationError(limited ? 'rateLimited' : refused ? 'blocked' : 'unavailable', last), { retryAfterMs });
}

const redditReads = new Map(); // name (lower case) -> { until, promise }

/**
 * A subreddit's latest posts. What was read is kept two minutes (and a reading in progress is shared), so looking an account up and then
 * following it asks Reddit once. The polling job passes `fresh` to always read anew; what it reads is kept too.
 */
function readReddit(name, { fresh = false } = {}) {
  const key = String(name).toLowerCase();
  const kept = redditReads.get(key);
  if (!fresh && kept && kept.until > Date.now()) return kept.promise;
  if (redditReads.size >= REDDIT_CACHE_LIMIT) redditReads.delete(redditReads.keys().next().value);
  const entry = { until: Infinity, promise: null };
  entry.promise = readRedditNow(name).then((feed) => { entry.until = Date.now() + REDDIT_KEEP_MS; return feed; }, (error) => { if (redditReads.get(key) === entry) redditReads.delete(key); throw error; });
  redditReads.set(key, entry);
  return entry.promise;
}

const forgetReddit = () => { redditReads.clear(); redditPace.coolUntil = 0; redditPace.lastAt = 0; }; // for the checks

/** `user` or `user/board` from a name or a Pinterest link. */
function parsePinterest(input) {
  const parts = String(input ?? '').trim().replace(/^https?:\/\/([a-z]{2,3}\.)?(www\.)?pinterest\.[a-z.]+\//i, '').replace(/^@/, '').split(/[?#]/)[0].split('/').filter(Boolean);
  if (!parts.length || !PINTEREST.test(parts[0]) || (parts[1] && !PINTEREST_BOARD.test(parts[1])) || parts[0].toLowerCase() === 'pin') return null;
  return parts[1] ? `${parts[0]}/${parts[1]}`.toLowerCase() : parts[0].toLowerCase();
}

const pinterestFeedUrl = (id) => (id.includes('/') ? `https://www.pinterest.com/${id}.rss` : `https://www.pinterest.com/${id}/feed.rss`);
/** The pictures of the feed are small (236 pixels); the same file exists larger. */
const bigPin = (image) => String(image ?? '').replace(/^(https?:\/\/i\.pinimg\.com)\/(?:236x|474x)\//i, '$1/736x/');

async function readPinterest(id) {
  const feed = parseFeed(await fetchText(pinterestFeedUrl(id)), { max: 20 });
  // `smallImage` is what the feed gave: the card falls back to it when the larger file does not load (see `buildFeedPayload`).
  return { ...feed, entries: feed.entries.map((entry) => ({ ...entry, smallImage: entry.image, image: bigPin(entry.image) })) };
}

/** A pin: the picture (the larger one, with the feed's own as a fallback), the pin's own words as the title when it has them, and the owner of the board as the byline. */
function pinterestItem(item, entry, account) {
  let owner = '';
  try { owner = new URL(account.url).pathname.split('/').filter(Boolean)[0] ?? ''; } catch { /* an account without a link */ }
  const source = String(account.name ?? '').replace(/\s+on Pinterest$/i, '');
  return { ...item, title: entry.title || source, source, author: entry.author || owner || source, authorUrl: account.url, imageFallback: entry.smallImage && entry.smallImage !== entry.image ? entry.smallImage : null };
}

module.exports = { normalizeUrl, usualFeedUrls, readRss, resolveRss, toItem, parseSubreddit, readReddit, parseRedditJson, forgetReddit, redditPace, REDDIT_USER_AGENT, parsePinterest, readPinterest, bigPin };
