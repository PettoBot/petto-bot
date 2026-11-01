// Accounts of the social and film sites that publish an RSS feed of what a person posts: Mastodon (any server), Tumblr and Letterboxd. They share the
// reader of the feeds of the other platforms; what is here is how each one is named and where its feed is.
const { fetchText, fetchPublicText } = require('../http');
const { parseFeed } = require('../feedparse');
const { IntegrationError } = require('../../utils/integrations');

const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const USER = /^[\w.\-]{1,60}$/;
const BLOG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const LETTERBOXD = /^[A-Za-z0-9_]{2,15}$/;

const toItem = (platform, type, entry, account, { keepTitle = true } = {}) => ({
  platform, type, id: entry.id, title: keepTitle ? entry.title || account.name : '', url: entry.url || account.url, description: entry.summary, image: entry.image || null, avatar: account.avatar ?? null,
  author: account.name, authorUrl: account.url, source: account.name, sourceUrl: account.url, publishedAt: entry.published, extra: '',
});

// --- Mastodon: `@user@server`, `user@server` or the link of a profile on any server ----------------------------------------------------------------------
/** `user@server` (lower case) from what a person wrote, or null. */
function parseMastodon(input) {
  const text = String(input ?? '').trim();
  const link = /^https?:\/\/([^/\s]+)\/(?:@|users\/)([\w.\-]+)/i.exec(text);
  const handle = link ? [link[2], link[1]] : /^@?([\w.\-]{1,60})@([^@\s/]+)$/.exec(text)?.slice(1);
  if (!handle) return null;
  const user = handle[0];
  const host = handle[1].toLowerCase().replace(/:\d+$/, '');
  return USER.test(user) && HOST.test(host) ? `${user.toLowerCase()}@${host}` : null;
}

const mastodonFeedUrl = (id) => { const [user, host] = id.split('@'); return `https://${host}/@${user}.rss`; };

async function readMastodon(id) {
  const answer = await fetchPublicText(mastodonFeedUrl(id)); // a server a person typed: only public addresses
  return parseFeed(answer.text, { max: 15 });
}

async function resolveMastodon(input) {
  const id = parseMastodon(input);
  if (!id) throw new IntegrationError('badInput');
  let feed;
  try { feed = await readMastodon(id); } catch (error) { if (error instanceof IntegrationError && error.kind === 'unavailable' && /^4/.test(String(error.message ?? ''))) throw new IntegrationError('notFound'); throw error; }
  if (!feed.title && !feed.entries.length) throw new IntegrationError('notFound');
  const [user, host] = id.split('@');
  return { id, name: `@${id}`, avatar: feed.image || null, url: `https://${host}/@${user}` };
}

// --- Tumblr ---------------------------------------------------------------------------------------------------------------------------------------------
/** The name of a blog from `name`, `name.tumblr.com` or a link to it (a blog on its own domain is not supported: it has no fixed address). */
function parseTumblr(input) {
  const text = String(input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\.tumblr\.com\/(?:blog\/(?:view\/)?)?/, '').split(/[/?#]/)[0].replace(/\.tumblr\.com$/, '').replace(/^@/, '');
  return BLOG.test(text) ? text : null;
}

async function readTumblr(name) {
  return parseFeed(await fetchText(`https://${encodeURIComponent(name)}.tumblr.com/rss`), { max: 15 });
}

async function resolveTumblr(input) {
  const name = parseTumblr(input);
  if (!name) throw new IntegrationError('badInput');
  const feed = await readTumblr(name);
  if (!feed.title && !feed.entries.length) throw new IntegrationError('notFound');
  return { id: name, name: feed.title || name, avatar: feed.image || null, url: `https://${name}.tumblr.com` };
}

// --- Letterboxd: what a person watches and writes (their diary) ----------------------------------------------------------------------------------------
/** The user name from `name`, `@name` or a link to the profile. */
function parseLetterboxd(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?letterboxd\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return LETTERBOXD.test(text) && !['film', 'films', 'lists', 'members', 'journal'].includes(text.toLowerCase()) ? text.toLowerCase() : null;
}

async function readLetterboxd(name) {
  return parseFeed(await fetchText(`https://letterboxd.com/${encodeURIComponent(name)}/rss/`), { max: 15 });
}

async function resolveLetterboxd(input) {
  const name = parseLetterboxd(input);
  if (!name) throw new IntegrationError('badInput');
  const feed = await readLetterboxd(name);
  if (!feed.title && !feed.entries.length) throw new IntegrationError('notFound');
  return { id: name, name: feed.title?.replace(/^Letterboxd\s*[-–—]\s*/i, '') || name, avatar: feed.image || null, url: `https://letterboxd.com/${name}/` };
}

module.exports = { toItem, parseMastodon, readMastodon, resolveMastodon, parseTumblr, readTumblr, resolveTumblr, parseLetterboxd, readLetterboxd, resolveLetterboxd };
