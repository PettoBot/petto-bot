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

module.exports = { featuredArticle, wikipediaItem, chessPuzzle, chessItem };
