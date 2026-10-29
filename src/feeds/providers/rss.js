// Feeds that are read as RSS or Atom: any blog or news site (`rss`), a subreddit (`reddit`) and a Pinterest profile or board (`pinterest`).
// A feed of a site a person typed is fetched only from public addresses (see `fetchPublicText`).
const { fetchText, fetchPublicText, publicUrl } = require('../http');
const { parseFeed, discoverFeed } = require('../feedparse');
const { IntegrationError } = require('../../utils/integrations');

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

const toItem = (platform, type, entry, account) => ({
  platform, type, id: entry.id, title: entry.title || account.name, url: entry.url || account.url, description: entry.summary, image: entry.image || null, avatar: account.avatar ?? null,
  author: account.name, authorUrl: account.url, publishedAt: entry.published, extra: '',
});

/** The reddit name from `r/name`, `/r/name`, a link to the subreddit or a post, or just the name. */
function parseSubreddit(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.|old\.|new\.)?reddit\.com/i, '').replace(/^\/?r\//i, '').split(/[/?#]/)[0];
  return REDDIT.test(text) ? text : null;
}

async function readReddit(name) {
  return parseFeed(await fetchText(`https://www.reddit.com/r/${encodeURIComponent(name)}/new/.rss`), { max: 15 });
}

/** `user` or `user/board` from a name or a Pinterest link. */
function parsePinterest(input) {
  const parts = String(input ?? '').trim().replace(/^https?:\/\/([a-z]{2,3}\.)?(www\.)?pinterest\.[a-z.]+\//i, '').replace(/^@/, '').split(/[?#]/)[0].split('/').filter(Boolean);
  if (!parts.length || !PINTEREST.test(parts[0]) || (parts[1] && !PINTEREST_BOARD.test(parts[1])) || parts[0].toLowerCase() === 'pin') return null;
  return parts[1] ? `${parts[0]}/${parts[1]}`.toLowerCase() : parts[0].toLowerCase();
}

const pinterestFeedUrl = (id) => (id.includes('/') ? `https://www.pinterest.com/${id}.rss` : `https://www.pinterest.com/${id}/feed.rss`);
/** The pictures of the feed are small (236 pixels); the same file exists larger. */
const bigPin = (image) => String(image ?? '').replace(/\/(236x|474x)\//, '/736x/');

async function readPinterest(id) {
  const feed = parseFeed(await fetchText(pinterestFeedUrl(id)), { max: 20 });
  return { ...feed, entries: feed.entries.map((entry) => ({ ...entry, image: bigPin(entry.image) })) };
}

module.exports = { normalizeUrl, usualFeedUrls, readRss, resolveRss, toItem, parseSubreddit, readReddit, parsePinterest, readPinterest, bigPin };
