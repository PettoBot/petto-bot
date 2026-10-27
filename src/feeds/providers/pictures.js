// Pictures by tags, as an auto feed: a person writes a few tags (`pink`, `cats aesthetic`, `rosa`) and how often, and the channel gets a picture of what is tagged that way, the same
// for every server that wrote the same tags at the same pace. The pictures come from the public feed of tags of Flickr (no key). Pinterest has no public way to search by tag, so
// this is the way to have the same idea: a picture for a tag. Each slot of time is asked once for all the servers.
const { fetchJsonBody } = require('../http');

const FEED = 'https://www.flickr.com/services/feeds/photos_public.gne';
const MAX_TAGS = 3;
// Words people write in Spanish and Portuguese for the colors and the things they ask for most, so `rosa` finds what `pink` finds.
const TRANSLATIONS = {
  rosa: 'pink', rosado: 'pink', rojo: 'red', vermelho: 'red', azul: 'blue', verde: 'green', amarillo: 'yellow', amarelo: 'yellow', morado: 'purple', violeta: 'purple', roxo: 'purple', naranja: 'orange', laranja: 'orange',
  negro: 'black', preto: 'black', blanco: 'white', branco: 'white', gris: 'gray', cinza: 'gray', marron: 'brown', marrom: 'brown', dorado: 'gold', dourado: 'gold', plateado: 'silver', prateado: 'silver',
  flores: 'flowers', flor: 'flower', gato: 'cat', gatos: 'cats', perro: 'dog', perros: 'dogs', cachorro: 'dog', playa: 'beach', praia: 'beach', cielo: 'sky', ceu: 'sky', mar: 'sea', montana: 'mountain',
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

const kept = new Map(); // tags -> { until, items }
const KEEP_MS = 10 * 60_000;
const slots = new Map(); // `${tags}:${slot}` -> item | null

/** The newest public pictures that have all of those tags (or any of them, when none has all). */
async function latest(tags) {
  const cached = kept.get(tags.join(','));
  if (cached && cached.until > Date.now()) return cached.items;
  const ask = async (mode) => (await fetchJsonBody(`${FEED}?tags=${encodeURIComponent(tags.join(','))}&tagmode=${mode}&format=json&nojsoncallback=1`))?.items ?? [];
  let items = await ask('all');
  if (!items.length && tags.length > 1) items = await ask('any');
  if (kept.size > 300) kept.clear();
  kept.set(tags.join(','), { until: Date.now() + KEEP_MS, items });
  return items;
}

const bigger = (url) => String(url ?? '').replace(/_m\.(jpg|png|gif)$/i, '_b.$1'); // the feed gives the small picture: the large one has the same name with _b

/** The picture of a slot of time for those tags, the same for everybody; null when there is none. */
async function pictureOf(tags, key, at) {
  const id = `${tags.join('+')}:${key}`;
  if (slots.has(id)) return slots.get(id);
  const items = (await latest(tags)).filter((entry) => /^https:\/\//.test(entry?.media?.m ?? '') && /^https:\/\/www\.flickr\.com\//.test(entry.link ?? ''));
  const seed = Math.abs(Number(String(key).split(':')[1]) || 0);
  const entry = items.length ? items[(seed * 2654435761 >>> 0) % items.length] : null;
  const item = entry ? {
    platform: 'pictures', type: 'photo', id: key, title: String(entry.title || tags.join(' ')).replace(/\s+/g, ' ').trim().slice(0, 200) || tags.join(' '), url: entry.link, description: '', image: bigger(entry.media.m), avatar: null,
    author: String(entry.author ?? '').replace(/^nobody@flickr\.com \("?|"?\)$/g, '').slice(0, 80), authorUrl: null, publishedAt: at, extra: tags.map((tag) => `#${tag}`).join(' '),
  } : null;
  if (slots.size > 300) slots.clear();
  slots.set(id, item);
  return item;
}

module.exports = { parseTags, refused, joinTags, tagsOf, pictureOf, MAX_TAGS };
