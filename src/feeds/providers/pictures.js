// Pictures by tags, as an auto feed: a person writes a few words (`pink`, `cats aesthetic`, `anime roses`) and how often, and the channel gets a picture of what was asked, the same
// for every server that wrote the same words at the same pace. Pinterest has no public way to search, so the pictures are searched in several places, the best one first:
//   - anime, manga and the like (a word such as `anime`): Wallhaven (its anime category, safe only) and Safebooru, no key;
//   - with the keys of the bot (config.js): Google Images (a Programmable Search Engine), Pixabay, Pexels and Unsplash, which search by meaning, not by tag;
//   - with no key: Openverse (free pictures, no adult content) and the public tags of Flickr.
// Every source is asked for safe pictures only. A source that fails or has nothing is skipped; the first ones that answer fill the list a picture is taken from.
const config = require('../../config');
const { fetchJsonBody } = require('../http');

const FEED = 'https://www.flickr.com/services/feeds/photos_public.gne';
const MAX_TAGS = 4;
const WANTED = 8; // pictures to have before asking one more place
// Words that ask for drawings of the anime kind: the other words are what is searched in the anime places.
const ANIME = new Set(['anime', 'animes', 'manga', 'waifu', 'chibi', 'ghibli', 'otaku', 'vtuber']);
// Words people write in Spanish and Portuguese for the colors and the things they ask for most, so `rosa` finds what `pink` finds.
const TRANSLATIONS = {
  rosa: 'pink', rosado: 'pink', rojo: 'red', vermelho: 'red', azul: 'blue', verde: 'green', amarillo: 'yellow', amarelo: 'yellow', morado: 'purple', violeta: 'purple', roxo: 'purple', naranja: 'orange', laranja: 'orange',
  negro: 'black', preto: 'black', blanco: 'white', branco: 'white', gris: 'gray', cinza: 'gray', marron: 'brown', marrom: 'brown', dorado: 'gold', dourado: 'gold', plateado: 'silver', prateado: 'silver',
  flores: 'flowers', rosas: 'roses', tulipanes: 'tulips', girasoles: 'sunflowers', chica: 'girl', chico: 'boy', corazon: 'heart', corazones: 'hearts', fondos: 'wallpaper', fondo: 'wallpaper', flor: 'flower', gato: 'cat', gatos: 'cats', perro: 'dog', perros: 'dogs', cachorro: 'dog', playa: 'beach', praia: 'beach', cielo: 'sky', ceu: 'sky', mar: 'sea', montana: 'mountain',
  montanas: 'mountains', montanha: 'mountain', bosque: 'forest', floresta: 'forest', ciudad: 'city', cidade: 'city', noche: 'night', noite: 'night', atardecer: 'sunset', 'por-do-sol': 'sunset', arte: 'art',
  comida: 'food', cafe: 'coffee', otono: 'autumn', outono: 'autumn', invierno: 'winter', inverno: 'winter', verano: 'summer', verao: 'summer', primavera: 'spring', lluvia: 'rain', chuva: 'rain', nieve: 'snow', neve: 'snow',
  estetica: 'aesthetic', pastel: 'pastel', vintage: 'vintage', naturaleza: 'nature', natureza: 'nature', mariposa: 'butterfly', borboleta: 'butterfly', pajaro: 'bird', passaro: 'bird', luna: 'moon', lua: 'moon', estrellas: 'stars', estrelas: 'stars',
};
// What a feed of pictures never posts: a server follows these tags to decorate a channel, not for what is not for everybody.
const REFUSED = /^(?:nsfw|nude|nudes|naked|nudity|porn|porno|xxx|sex|sexy|erotic|erotica|lingerie|topless|bikini|fetish|boudoir|adult|gore|desnudo|desnuda|desnudos|sexo|erotico|nu|nua|pelada|pelado)$/;

/** The tags of what a person wrote: up to three, lower case, without accents or signs; the common Spanish and Portuguese words are turned into the English ones. */
function parseTags(text) {
  const words = String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[\s,+;#]+/).map((word) => word.replace(/[^a-z0-9-]/g, '')).filter((word) => word.length >= 2 && word.length <= 24);
  const tags = [];
  for (const word of words) {
    const tag = TRANSLATIONS[word] ?? word;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, MAX_TAGS);
}

const refused = (tags) => tags.some((tag) => REFUSED.test(tag));

/** `pink+cat` (the part of the account that says which tags). */
const joinTags = (tags) => tags.join('+');
const tagsOf = (accountId) => String(accountId ?? '').split(':').slice(2).join(':').split('+').filter(Boolean);

const kept = new Map(); // words -> { until, items }
const KEEP_MS = 10 * 60_000;
const slots = new Map(); // `${tags}:${slot}` -> item | null

const https = (url) => (/^https:\/\/[^\s]+$/i.test(String(url ?? '')) ? String(url) : null);
const clip = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const encode = encodeURIComponent;
/** A tag as a booru writes it: one word, the plural taken off (`roses` is `rose`). */
const booruTag = (word) => word.replace(/ies$/, 'y').replace(/([^s])s$/, '$1');

// Each source gives `[{ image, url, title, author }]` for the words asked, or throws when it cannot answer. `needs` says what it has to have: a key, or nothing.
const SOURCES = [
  {
    name: 'Wallhaven', anime: true, needs: () => true, // i18n-ignore: the name of a service
    async search(words) {
      const data = await fetchJsonBody(`https://wallhaven.cc/api/v1/search?q=${encode(words.join(' '))}&categories=010&purity=100&sorting=relevance&atleast=1280x720`);
      return (data?.data ?? []).map((entry) => ({ image: https(entry.path), url: https(entry.url), title: '', author: '' }));
    },
  },
  {
    name: 'Safebooru', anime: true, needs: () => true, // i18n-ignore: the name of a service
    async search(words) {
      const tags = words.map(booruTag).map((word) => word.replace(/[^a-z0-9_]/g, '')).filter(Boolean);
      if (!tags.length) return [];
      const data = await fetchJsonBody(`https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=60&tags=${encode(tags.join(' '))}`);
      // A big picture has a sample (a smaller jpg) that Discord shows faster; the rest are shown as they are.
      return (Array.isArray(data) ? data : []).map((entry) => ({
        image: https(entry.sample ? `https://safebooru.org/samples/${entry.directory}/sample_${String(entry.image).replace(/\.[a-z0-9]+$/i, '')}.jpg` : `https://safebooru.org/images/${entry.directory}/${entry.image}`),
        url: https(`https://safebooru.org/index.php?page=post&s=view&id=${entry.id}`), title: '', author: '',
      }));
    },
  },
  {
    name: 'Google', needs: () => Boolean(config.googleCseKey && config.googleCseCx), // i18n-ignore: the name of a service
    async search(words) {
      const data = await fetchJsonBody(`https://www.googleapis.com/customsearch/v1?key=${encode(config.googleCseKey)}&cx=${encode(config.googleCseCx)}&q=${encode(words.join(' '))}&searchType=image&safe=active&num=10&imgSize=large`);
      return (data?.items ?? []).map((entry) => ({ image: https(entry.link), url: https(entry.image?.contextLink), title: clip(entry.title, 200), author: '' }));
    },
  },
  {
    name: 'Pixabay', needs: () => Boolean(config.pixabayApiKey), // i18n-ignore: the name of a service
    async search(words) {
      const data = await fetchJsonBody(`https://pixabay.com/api/?key=${encode(config.pixabayApiKey)}&q=${encode(words.join(' '))}&image_type=photo&safesearch=true&per_page=40&order=popular`);
      return (data?.hits ?? []).map((entry) => ({ image: https(entry.largeImageURL), url: https(entry.pageURL), title: clip(entry.tags, 200), author: clip(entry.user, 80) }));
    },
  },
  {
    name: 'Pexels', needs: () => Boolean(config.pexelsApiKey), // i18n-ignore: the name of a service
    async search(words) {
      const data = await fetchJsonBody(`https://api.pexels.com/v1/search?query=${encode(words.join(' '))}&per_page=40`, { headers: { Authorization: config.pexelsApiKey } });
      return (data?.photos ?? []).map((entry) => ({ image: https(entry.src?.large2x ?? entry.src?.large), url: https(entry.url), title: clip(entry.alt, 200), author: clip(entry.photographer, 80) }));
    },
  },
  {
    name: 'Unsplash', needs: () => Boolean(config.unsplashAccessKey), // i18n-ignore: the name of a service
    async search(words) {
      const data = await fetchJsonBody(`https://api.unsplash.com/search/photos?query=${encode(words.join(' '))}&per_page=30&content_filter=high`, { headers: { Authorization: `Client-ID ${config.unsplashAccessKey}` } });
      return (data?.results ?? []).map((entry) => ({ image: https(entry.urls?.regular), url: https(entry.links?.html), title: clip(entry.alt_description ?? entry.description, 200), author: clip(entry.user?.name, 80) }));
    },
  },
  {
    name: 'Openverse', needs: () => true, // i18n-ignore: the name of a service
    async search(words) {
      const data = await fetchJsonBody(`https://api.openverse.org/v1/images/?q=${encode(words.join(' '))}&page_size=30&mature=false&category=photograph,illustration`);
      return (data?.results ?? []).map((entry) => ({ image: https(entry.url), url: https(entry.foreign_landing_url), title: clip(entry.title, 200), author: clip(entry.creator, 80) }));
    },
  },
  {
    name: 'Flickr', needs: () => true, tagged: true, // i18n-ignore: the name of a service
    async search(words) {
      const ask = async (mode) => (await fetchJsonBody(`${FEED}?tags=${encode(words.join(','))}&tagmode=${mode}&format=json&nojsoncallback=1`))?.items ?? [];
      let items = await ask('all');
      if (!items.length && words.length > 1) items = await ask('any');
      // The feed gives the small picture: the large one has the same name with _b.
      return items.filter((entry) => /^https:\/\/www\.flickr\.com\//.test(entry?.link ?? '')).map((entry) => ({
        image: https(String(entry?.media?.m ?? '').replace(/_m\.(jpg|png|gif)$/i, '_b.$1')), url: https(entry.link), title: clip(entry.title, 200),
        author: clip(String(entry.author ?? '').replace(/^nobody@flickr\.com \("?|"?\)$/g, ''), 80),
      }));
    },
  },
];

/** The places to ask for a picture of those tags, best first: the anime ones when a word asks for anime, then the ones with a key, then the free ones. */
function sourcesFor(tags) {
  const anime = tags.some((tag) => ANIME.has(tag));
  return SOURCES.filter((source) => source.needs() && (anime || !source.anime));
}

/** The words that are searched: without the word that asks for anime in the anime places (which are only of anime), with it in the rest. */
const wordsFor = (source, tags) => {
  const rest = tags.filter((tag) => !ANIME.has(tag));
  return source.anime && rest.length ? rest : tags;
};

/** The pictures found for those tags, as `[{ image, url, title, author, source }]` (no repeats). Throws when no place had any and one failed, so the feed says so. */
async function latest(tags) {
  const key = tags.join(',');
  const cached = kept.get(key);
  if (cached && cached.until > Date.now()) return cached.items;
  const items = [];
  const seen = new Set();
  let failure = null;
  for (const source of sourcesFor(tags)) {
    if (items.length >= WANTED) break;
    try {
      for (const entry of await source.search(wordsFor(source, tags))) {
        if (!entry.image || !entry.url || seen.has(entry.image)) continue;
        seen.add(entry.image);
        items.push({ ...entry, source: source.name });
      }
    } catch (error) {
      failure ??= error;
    }
  }
  if (!items.length && failure) throw failure;
  if (kept.size > 300) kept.clear();
  kept.set(key, { until: Date.now() + KEEP_MS, items });
  return items;
}

/** The picture of a slot of time for those tags, the same for everybody; null when there is none. */
async function pictureOf(tags, key, at) {
  const id = `${tags.join('+')}:${key}`;
  if (slots.has(id)) return slots.get(id);
  const items = await latest(tags);
  const seed = Math.abs(Number(String(key).split(':')[1]) || 0);
  const entry = items.length ? items[(seed * 2654435761 >>> 0) % items.length] : null;
  const item = entry ? {
    platform: 'pictures', type: 'photo', id: key, title: entry.title || tags.join(' '), url: entry.url, description: '', image: entry.image, avatar: null,
    author: entry.author, authorUrl: null, publishedAt: at, extra: `${tags.map((tag) => `#${tag}`).join(' ')} · ${entry.source}`,
  } : null;
  if (slots.size > 300) slots.clear();
  slots.set(id, item);
  return item;
}

module.exports = { parseTags, refused, joinTags, tagsOf, pictureOf, MAX_TAGS };
