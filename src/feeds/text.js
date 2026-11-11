// Cleaning the text a service sends before it goes into a card: no markup, one line, a size that fits.
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 220;
const MAX_TOP = 1500;

// Emojis: the pictographs with their joiners and variation marks, skin tones (alone they are drawn as little squares), flags, keycaps and the custom ones (`<:name:id>`).
const EMOJI = /<a?:\w+:\d+>|[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\uFE0E\uFE0F\u20E3\u{E0020}-\u{E007F}]/gu;

// What may stay in the words of a link: letters, marks of the letters, numbers, punctuation, currency, spaces, the plain keyboard (ASCII) and the invisible space that keeps
// `@everyone` from mentioning. Anything else (pictographs, skin tones, symbols, joiners, an emoji of a Unicode newer than this list) is out, so a link never breaks
// because of a character that nobody listed.
const NOT_FOR_A_LINK = /[^\p{L}\p{M}\p{N}\p{P}\p{Sc}\p{Zs}\u0020-\u007E\u200B]/gu;

const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

/** Cuts a text to `max` characters on a word, with an ellipsis. */
function clip(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Plain text: HTML tags and entities out, links shortened to their words, one line, and nothing that could mention or format by accident. */
function plainText(text, max = MAX_DESCRIPTION, { link = false } = {}) {
  let value = String(text ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => entities[entity])
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  value = value.replace(/@(everyone|here)/gi, '@​$1').replace(/<@/g, '<​@').replace(/[\\*_~`|>]/g, (char) => `\\${char}`); // the backslash too, so a backslash in the text cannot undo an escape
  // Discord does not read a link whose words hold an escaped bracket (it shows the markdown as it is), so there the brackets are written as the full-width ones.
  if (link) value = value.replace(/\[/g, '［').replace(/\]/g, '］');
  // Discord shows the markdown as it is (no blue link) when the words of a link hold an emoji, so the emojis of a title are left out of the link (the ones that are known, and then
  // everything that is not a plain character, in case an emoji is new); the button of the card still opens it.
  if (link) value = value.replace(EMOJI, '').replace(NOT_FOR_A_LINK, '').replace(/\s{2,}/g, ' ').trim();
  return clip(value, max);
}

/** The text of a link in markdown: its brackets cannot end it early (they are written as the full-width ones). */
const linkText = (text) => plainText(text, MAX_TITLE, { link: true });

/** A link Discord can open (http or https), or null. */
function safeUrl(url) {
  try {
    const parsed = new URL(String(url ?? ''));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

module.exports = { MAX_TITLE, MAX_DESCRIPTION, MAX_TOP, clip, plainText, linkText, safeUrl };
