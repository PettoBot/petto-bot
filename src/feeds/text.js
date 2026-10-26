// Cleaning the text a service sends before it goes into a card: no markup, one line, a size that fits.
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 220;
const MAX_TOP = 1500;

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
function plainText(text, max = MAX_DESCRIPTION) {
  let value = String(text ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => entities[entity])
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  value = value.replace(/@(everyone|here)/gi, '@​$1').replace(/<@/g, '<​@').replace(/[*_~`|>]/g, (char) => `\\${char}`);
  return clip(value, max);
}

/** The text of a link in markdown: its brackets cannot end it early. */
const linkText = (text) => plainText(text, MAX_TITLE).replace(/\[/g, '\\[').replace(/\]/g, '\\]');

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
