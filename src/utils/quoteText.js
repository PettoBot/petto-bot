// i18n-ignore-file: this turns a message into the pieces drawn on a quote picture; the only texts are Discord's own marks
// Turns the text of a Discord message into the pieces drawn by the quote picture (src/imgutils/quoteCard.js): plain text with
// the mentions written as names, links shortened, Markdown marks removed, and every emoji (custom or Unicode) as a piece of
// its own so the picture can draw it as an image.

const MAX_INPUT = 600; // characters read from a message; the picture could not show more anyway
const MAX_EMOJIS = 40;

/** The Twemoji file name of a Unicode emoji: its code points in hex, with the variation selector dropped unless it is a ZWJ sequence. */
function twemojiCode(emoji) {
  const points = [...emoji].map((char) => char.codePointAt(0));
  const kept = points.includes(0x200d) ? points : points.filter((point) => point !== 0xfe0f);
  return kept.map((point) => point.toString(16)).join('-');
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const KEYCAP = /^[#*0-9]️?⃣$/u;
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** True when a grapheme is an emoji drawn in color (not a plain symbol like © written without the emoji selector). */
function isEmojiGrapheme(grapheme) {
  if (KEYCAP.test(grapheme)) return true;
  if (!PICTOGRAPHIC.test(grapheme)) return false;
  // Old text symbols (©, ®, ‼, ™, ℹ) only count as emoji with the emoji selector after them.
  if (grapheme.codePointAt(0) < 0x2190) return grapheme.includes('️');
  return true;
}

/** A link written short: its host, and `/…` when it had a path. */
function shortLink(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    const rest = `${url.pathname}${url.search}`.replace(/\/$/, '');
    return rest ? `${host}/…` : host;
  } catch {
    return raw.length > 30 ? `${raw.slice(0, 29)}…` : raw;
  }
}

/** Removes the Markdown marks of Discord, keeping what they wrap. */
function stripMarkdown(text) {
  return text
    .replace(/```(?:[a-z0-9_+-]*\n)?([\s\S]*?)```/gi, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\|\|([\s\S]*?)\|\|/g, '$1')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/__([\s\S]*?)__/g, '$1')
    .replace(/~~([\s\S]*?)~~/g, '$1')
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])_(?!\s)([^_\n]+?)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/^(?:>>> |> |#{1,3} |-# )/gm, '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1');
}

/**
 * The pieces of a message, ready to draw: `{ type: 'text', text }` and `{ type: 'emoji', key, url, fallback }`. `names` gives the
 * names to write for mentions: `user(id)`, `role(id)`, `channel(id)`, each returning a name or null.
 */
function quotePieces(content, names = {}) {
  const user = names.user ?? (() => null);
  const role = names.role ?? (() => null);
  const channel = names.channel ?? (() => null);
  let text = String(content ?? '').replace(/\r\n?/g, '\n');
  if (text.length > MAX_INPUT * 2) text = text.slice(0, MAX_INPUT * 2);
  text = stripMarkdown(text)
    .replace(/<@!?(\d{15,25})>/g, (_, id) => `@${user(id) ?? 'user'}`)
    .replace(/<@&(\d{15,25})>/g, (_, id) => `@${role(id) ?? 'role'}`)
    .replace(/<#(\d{15,25})>/g, (_, id) => `#${channel(id) ?? 'channel'}`)
    .replace(/<\/([\w -]{1,64}):\d{15,25}>/g, '/$1')
    .replace(/<t:(-?\d{1,13})(?::[tTdDfFR])?>/g, (_, seconds) => {
      const date = new Date(Number(seconds) * 1000);
      return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    })
    .replace(/<?(https?:\/\/[^\s<>]+)>?/g, (_, link) => shortLink(link))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > MAX_INPUT) text = `${text.slice(0, MAX_INPUT - 1).trimEnd()}…`;

  const pieces = [];
  let emojis = 0;
  const pushText = (value) => {
    if (!value) return;
    const last = pieces[pieces.length - 1];
    if (last?.type === 'text') last.text += value;
    else pieces.push({ type: 'text', text: value });
  };
  const CUSTOM = /<(a?):([\w~]{1,32}):(\d{15,25})>/g;
  let cursor = 0;
  for (const match of text.matchAll(CUSTOM)) {
    pushUnicode(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (emojis >= MAX_EMOJIS) { pushText(`:${match[2]}:`); continue; }
    emojis += 1;
    pieces.push({ type: 'emoji', key: `custom:${match[3]}`, url: `https://cdn.discordapp.com/emojis/${match[3]}.png?size=96`, fallback: `:${match[2]}:` });
  }
  pushUnicode(text.slice(cursor));

  function pushUnicode(part) {
    if (!part) return;
    if (!segmenter) { pushText(part); return; }
    let buffer = '';
    for (const { segment } of segmenter.segment(part)) {
      if (emojis < MAX_EMOJIS && isEmojiGrapheme(segment)) {
        pushText(buffer);
        buffer = '';
        emojis += 1;
        const code = twemojiCode(segment);
        pieces.push({ type: 'emoji', key: `twemoji:${code}`, url: `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${code}.png`, fallback: segment });
      } else {
        buffer += segment;
      }
    }
    pushText(buffer);
  }
  return pieces;
}

/** True when the pieces have nothing to show. */
function isEmptyQuote(pieces) {
  return !pieces.some((piece) => piece.type === 'emoji' || piece.text.trim());
}

module.exports = { quotePieces, isEmptyQuote, shortLink, stripMarkdown, twemojiCode, isEmojiGrapheme, MAX_INPUT };
