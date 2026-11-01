// Reads an RSS or Atom feed (a blog, a subreddit, a Pinterest profile, Mastodon...) into the same plain entries. It reads the text on purpose
// instead of building a document: the feeds are untrusted, so nothing in them is ever run or followed, only picked apart.
const { clip } = require('./text');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (text) => String(text ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (m, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; } })
  .replace(/&#(\d+);/g, (m, dec) => { try { return String.fromCodePoint(Number(dec)); } catch { return ''; } })
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, name) => NAMED[name]);
const unwrap = (text) => { const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text); return cdata ? cdata[1] : decode(text); };

/** Plain text from a piece of html: tags out, entities read, one line. The card escapes it for Discord, so it is not escaped here. */
const clean = (html, max) => clip(decode(String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^<>]*>/g, ' ')).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(), max);

/** The text inside the first `<name>` of a piece of xml ('' if none). */
const tag = (xml, name) => { const found = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml); return found ? unwrap(found[1]).trim() : ''; };
/** An attribute of the first `<name ...>` of a piece of xml. */
const attr = (xml, name, key) => { const found = new RegExp(`<${name}\\b[^>]*?\\b${key}\\s*=\\s*"([^"]*)"`, 'i').exec(xml); return found ? decode(found[1]) : ''; };
/** The link of an Atom entry (the alternate one) or of an RSS item. */
function linkOf(entry) {
  const links = [...entry.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const alternate = links.find((l) => !/\brel\s*=\s*"(?!alternate")/i.test(l) && /\bhref\s*=/.test(l)) ?? links.find((l) => /\bhref\s*=/.test(l));
  if (alternate) return decode(/\bhref\s*=\s*"([^"]*)"/.exec(alternate)[1]);
  return tag(entry, 'link');
}
const httpsOnly = (value) => (/^https?:\/\//i.test(value) ? value.replace(/^http:\/\//i, 'https://') : '');

/** The first picture of an entry: media tags, an enclosure that is an image, or the first <img> of its text. */
function imageOf(entry, html) {
  const media = attr(entry, 'media:content', 'url') || attr(entry, 'media:thumbnail', 'url');
  const enclosure = /<enclosure\b[^>]*\btype\s*=\s*"image\//i.test(entry) ? attr(entry, 'enclosure', 'url') : '';
  const img = /<img\b[^>]*\b(?:src|data-src)\s*=\s*["']?([^"'\s>]+)/i.exec(html)?.[1];
  // A feed that writes its text twice-escaped (`&amp;lt;img ...`) or without quotes still holds the address of its picture: the image host of Pinterest is looked for in the raw entry as the last resort.
  const pin = /https?:\/\/i\.pinimg\.com\/[\w/.\-]+\.(?:jpe?g|png|gif|webp)/i.exec(entry)?.[0];
  return httpsOnly(media || enclosure || (img ? decode(img) : '') || pin || '');
}

/**
 * What kind of feed a text is, by its first element: `rss` (RSS 2.0 or 0.9x), `rdf` (RSS 1.0), `atom`, or null for anything else (a web page,
 * an error page, JSON). The XML declaration, comments, a doctype and processing instructions (a stylesheet) before it are skipped.
 */
function feedKind(text) {
  const start = String(text ?? '').replace(/^﻿/, '').replace(/^(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i, '');
  const root = /^<([A-Za-z][\w.-]*(?::[\w.-]+)?)[\s>/]/.exec(start)?.[1]?.toLowerCase();
  if (root === 'rss') return 'rss';
  if (root === 'rdf:rdf') return 'rdf';
  if (root === 'feed' || root === 'atom:feed') return 'atom';
  return null;
}

/**
 * `{ isFeed, title, link, image, entries: [{ id, title, url, summary, html, image, thumbnail, published, author, authorUrl }] }`, newest first as the feed gives them.
 * A text that is not a feed gives no entries and no title.
 */
function parseFeed(xml, { max = 20 } = {}) {
  const text = String(xml ?? '');
  // Only a document that is a feed is read as one: a web page has a <title> too, and was taken for a feed with no entries that never posted.
  const kind = feedKind(text);
  if (!kind) return { isFeed: false, title: '', link: '', image: '', entries: [] };
  const atom = kind === 'atom';
  const pieces = text.split(atom ? /<entry[\s>]/i : /<item[\s>]/i);
  const head = pieces[0];
  const entries = pieces.slice(1, max + 1).map((piece) => {
    const entry = piece.split(atom ? /<\/entry>/i : /<\/item>/i)[0];
    const body = tag(entry, 'content:encoded') || tag(entry, 'content') || tag(entry, 'description') || tag(entry, 'summary');
    const url = linkOf(entry);
    const id = tag(entry, 'guid') || tag(entry, 'id') || url;
    const authorBlock = /<author[^>]*>([\s\S]*?)<\/author>/i.exec(entry)?.[1] ?? '';
    return {
      id: String(id).slice(0, 300), title: clean(tag(entry, 'title'), 250), url: httpsOnly(url), summary: clean(body, 400), html: body.slice(0, 8000), thumbnail: httpsOnly(attr(entry, 'media:thumbnail', 'url')),
      authorUrl: httpsOnly(tag(authorBlock, 'uri') || tag(authorBlock, 'url')), image: imageOf(entry, body), published: Date.parse(tag(entry, atom ? 'published' : 'pubDate') || tag(entry, 'updated') || tag(entry, 'dc:date')) || null,
      author: clean(tag(authorBlock, 'name') || authorBlock.trim() || tag(entry, 'dc:creator'), 80),
    };
  }).filter((entry) => entry.id && (entry.title || entry.url));
  const channel = head.split(/<(?:item|entry)[\s>]/i)[0];
  const imageBlock = /<image[^>]*>([\s\S]*?)<\/image>/i.exec(channel)?.[1] ?? '';
  return {
    isFeed: true,
    title: clean(tag(channel, 'title'), 120), link: httpsOnly(atom ? linkOf(channel) : tag(channel.replace(/<image[\s\S]*?<\/image>/i, ''), 'link')),
    image: httpsOnly(tag(imageBlock, 'url') || tag(channel, 'logo') || tag(channel, 'icon')), entries,
  };
}

/** The feed a page points to (`<link rel="alternate" type="application/rss+xml" href=...>`), as an absolute link, or null. */
function discoverFeed(html, base) {
  for (const link of String(html ?? '').matchAll(/<link\b[^>]*>/gi)) {
    if (/rel\s*=\s*["']?alternate/i.test(link[0]) && /type\s*=\s*["']application\/(rss|atom)\+xml/i.test(link[0])) {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(link[0])?.[1];
      if (href) { try { return new URL(decode(href), base).toString(); } catch { /* a broken link in the page */ } }
    }
  }
  return null;
}

module.exports = { parseFeed, discoverFeed, feedKind, tag, attr, decode, clean };
