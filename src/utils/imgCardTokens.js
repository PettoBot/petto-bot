// {imgcard:name}: puts the image card `name` in a message. It can be written in any text of the message (the text, a title, a
// description, a footer, a text of a Components V2 design) and in a message code. The token is taken out of the text and the
// message gets the card the same way a saved design that points at a card does. {imgcard:name|attachment} sends the picture on
// its own instead of inside the first embed.
// Same cleaning as db/imageCards.normalizeName, kept here so reading a message never needs the database.
const normalizeName = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40);

const TOKEN = /\{imgcard:\s*([a-z0-9][a-z0-9 _-]{0,39}?)\s*(?:\|\s*(embed|attachment|default)\s*)?\}/gi;
const MARK = '{imgcard:';

function strip(value, found) {
  if (typeof value === 'string') {
    if (!value.toLowerCase().includes(MARK)) return value;
    return value.replace(TOKEN, (_, name, placement) => {
      found.push({ name: normalizeName(name), placement: placement ? placement.toLowerCase() : 'default' });
      return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
  }
  if (Array.isArray(value)) return value.map((item) => strip(item, found));
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = strip(item, found);
    return copy;
  }
  return value;
}

/**
 * The message without its {imgcard:...} tokens, and the card they asked for (the first one, or null). A message that has none
 * comes back as it was, and a card the saved design already points at is kept.
 */
function pullImgCards(data) {
  if (!data || typeof data !== 'object') return { data, card: null };
  let text;
  try { text = JSON.stringify(data); } catch { return { data, card: null }; }
  if (!text.toLowerCase().includes(MARK)) return { data, card: null };
  const found = [];
  const cleaned = strip(data, found);
  return { data: cleaned, card: found[0] ?? null };
}

/** Text with the tokens taken out, for the places that never draw a card. */
function removeImgCardTokens(text) {
  return typeof text === 'string' && text.toLowerCase().includes(MARK) ? text.replace(TOKEN, '') : text;
}

module.exports = { pullImgCards, removeImgCardTokens, TOKEN };
