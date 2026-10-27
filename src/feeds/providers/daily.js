// Things of the day that are the same for everybody: the featured article of Wikipedia and the daily puzzle of Chess.com. Public APIs, no key.
const { fetchJsonBody } = require('../http');

const WIKI_LANG = { en: 'en', es: 'es', 'pt-BR': 'pt' };
const dayParts = (now) => { const d = new Date(now); return [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')]; };

const articles = new Map(); // `${lang}:${day}` -> article | null (a day does not change; each language is asked once a day)

/** The featured article of a day in a language, or null when that Wikipedia has none. */
async function featuredArticle(lang = 'en', now = Date.now()) {
  const code = WIKI_LANG[lang] ?? 'en';
  const [y, m, d] = dayParts(now);
  const key = `${code}:${y}${m}${d}`;
  if (articles.has(key)) return articles.get(key);
  const body = await fetchJsonBody(`https://${code}.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`);
  const tfa = body?.tfa;
  const article = tfa ? {
    id: `${y}${m}${d}:${code}`, title: tfa.titles?.normalized ?? tfa.title ?? '', summary: String(tfa.extract ?? ''), url: tfa.content_urls?.desktop?.page ?? `https://${code}.wikipedia.org/`,
    image: tfa.originalimage?.source ?? tfa.thumbnail?.source ?? null, thumb: tfa.thumbnail?.source ?? null,
  } : null;
  if (articles.size > 50) articles.clear();
  articles.set(key, article);
  return article;
}

const wikipediaItem = (article, now = Date.now()) => ({
  platform: 'wikipedia', type: 'daily', id: article.id, title: article.title, url: article.url, description: article.summary, image: article.image, avatar: article.thumb ?? null, author: 'Wikipedia', publishedAt: now, extra: '',
});

/** The daily puzzle of Chess.com: `{ id, title, url, image }`. */
async function chessPuzzle() {
  const body = await fetchJsonBody('https://api.chess.com/pub/puzzle');
  if (!body?.url) return null;
  return { id: String(body.publish_time ?? body.url), title: String(body.title || 'Chess.com'), url: body.url, image: body.image ?? null, published: Number(body.publish_time) * 1000 || null };
}

const chessItem = (puzzle) => ({
  platform: 'chess', type: 'daily', id: puzzle.id, title: puzzle.title, url: puzzle.url, description: '', image: puzzle.image, avatar: null, author: 'Chess.com', publishedAt: puzzle.published, extra: '',
});

// For the auto feeds that post every few minutes: one random article / puzzle for each slot of time, kept so every server of that pace gets the same one.
const slots = new Map();
const keepSlot = (key, value) => { if (slots.size > 200) slots.clear(); slots.set(key, value); return value; };

/** A random article of Wikipedia in a language, the same for everybody in a slot (`key`). */
async function randomArticle(lang, key) {
  const code = WIKI_LANG[lang] ?? 'en';
  const kept = `w:${code}:${key}`;
  if (slots.has(kept)) return slots.get(kept);
  const page = await fetchJsonBody(`https://${code}.wikipedia.org/api/rest_v1/page/random/summary`);
  const article = page?.title ? {
    id: key, title: page.titles?.normalized ?? page.title, summary: String(page.extract ?? ''), url: page.content_urls?.desktop?.page ?? `https://${code}.wikipedia.org/`,
    image: page.originalimage?.source ?? page.thumbnail?.source ?? null, thumb: page.thumbnail?.source ?? null,
  } : null;
  return keepSlot(kept, article);
}

/** A random puzzle of Chess.com, the same for everybody in a slot (`key`). */
async function randomPuzzle(key) {
  const kept = `c:${key}`;
  if (slots.has(kept)) return slots.get(kept);
  const body = await fetchJsonBody('https://api.chess.com/pub/puzzle/random');
  const puzzle = body?.url ? { id: key, title: String(body.title || 'Chess.com'), url: body.url, image: body.image ?? null, published: null } : null;
  return keepSlot(kept, puzzle);
}

module.exports = { featuredArticle, wikipediaItem, chessPuzzle, chessItem, randomArticle, randomPuzzle };
