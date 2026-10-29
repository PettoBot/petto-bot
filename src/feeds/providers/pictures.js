// Pictures by tags, as an auto feed: a person writes a few words (`pink`, `cats aesthetic`, `anime roses`) and how often, and the channel gets a picture of what was asked, the same
// for every server that wrote the same words at the same pace. Pinterest has no public way to search, so the pictures are searched in several places, the best one first:
//   - drawings (a word such as `anime`, or the name of a character that is only drawn, such as `cinnamoroll`): Konachan, Yande.re (safe only, the best scored first),
//     Safebooru and Wallhaven (its anime category, safe only), all without a key, so no photo comes for them; every one of them is asked until there are 160 pictures, and the
//     pictures of the slots go one after the other along that list (always in the same order), so a picture does not come again until all of them were posted;
//   - with the keys of the bot (config.js): Google Images (a Programmable Search Engine), Pixabay, Pexels and Unsplash, which search by meaning, not by tag;
//   - with no key: Openverse (free pictures, no adult content) and the public tags of Flickr.
// Every word asked for has to be in what a place says of a picture (its tags, its title or its description; a color can also be the color filter of the place), so
// `flor rosa anime` never gives a mountain or a pink car. A word with more than one meaning (`rosa`: the flower, the color, Monte Rosa) is asked about before the feed is
// saved, unless the other words say which one it is. Every source is asked for safe pictures only. A source that fails or has nothing is skipped. The picture that is
// posted is checked first (a real PNG, JPEG, GIF or WebP that loads), and the places whose links expire or refuse other sites are sent as a file.
const config = require('../../config');
const { fetchJsonBody } = require('../http');
const { imageReady } = require('../picture');
const { IntegrationError } = require('../../utils/integrations');

const FEED = 'https://www.flickr.com/services/feeds/photos_public.gne';
const MAX_TAGS = 4;
const MAX_NOT = 3; // words that a picture must not have (`-character`)
const WANTED = 30; // pictures of photos to have before asking one more place
const POOL = 160; // drawings to have before the anime places stop being asked (they are asked one after the other until there are this many)
const MAX_IMAGE_URL = 2000; // Discord refuses a longer link for a picture
const PROBES = 6; // pictures looked at before a slot goes without one

const strip = (word) => String(word ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Words that ask for drawings of the anime kind: the other words are what is searched in the anime places.
const ANIME = new Set(['anime', 'animes', 'manga', 'waifu', 'chibi', 'ghibli', 'otaku', 'vtuber']);
// Words that say how a picture looks, not what is in it: they never decide what another word means.
const STYLE = new Set([...ANIME, 'aesthetic', 'wallpaper', 'pastel', 'vintage', 'art', 'cute', 'kawaii', 'dark', 'soft', 'hd', '4k']);
// Words people write in Spanish and Portuguese for the colors and the things they ask for most, so `rosado` finds what `pink` finds.
const TRANSLATIONS = {
  rosado: 'pink', rojo: 'red', roja: 'red', vermelho: 'red', vermelha: 'red', azul: 'blue', verde: 'green', amarillo: 'yellow', amarilla: 'yellow', amarelo: 'yellow', amarela: 'yellow', morado: 'purple', morada: 'purple', roxo: 'purple', roxa: 'purple',
  negro: 'black', negra: 'black', preto: 'black', preta: 'black', blanco: 'white', blanca: 'white', branco: 'white', branca: 'white', gris: 'gray', cinza: 'gray', marron: 'brown', marrom: 'brown', dorado: 'gold', dorada: 'gold', dourado: 'gold', plateado: 'silver', prateado: 'silver',
  flores: 'flowers', rosas: 'roses', tulipanes: 'tulips', girasoles: 'sunflowers', chica: 'girl', chico: 'boy', corazon: 'heart', corazones: 'hearts', fondos: 'wallpaper', fondo: 'wallpaper', flor: 'flower', gato: 'cat', gatos: 'cats', perro: 'dog', perros: 'dogs', cachorro: 'dog', playa: 'beach', praia: 'beach', cielo: 'sky', ceu: 'sky', mar: 'sea', montana: 'mountain',
  montanas: 'mountains', montanha: 'mountain', bosque: 'forest', floresta: 'forest', ciudad: 'city', cidade: 'city', noche: 'night', noite: 'night', atardecer: 'sunset', 'por-do-sol': 'sunset', arte: 'art',
  comida: 'food', cafe: 'coffee', otono: 'autumn', outono: 'autumn', invierno: 'winter', inverno: 'winter', verano: 'summer', verao: 'summer', primavera: 'spring', lluvia: 'rain', chuva: 'rain', nieve: 'snow', neve: 'snow',
  estetica: 'aesthetic', estetico: 'aesthetic', pastel: 'pastel', vintage: 'vintage', naturaleza: 'nature', natureza: 'nature', mariposa: 'butterfly', borboleta: 'butterfly', pajaro: 'bird', passaro: 'bird', luna: 'moon', lua: 'moon', estrellas: 'stars', estrelas: 'stars',
  lindo: 'cute', linda: 'cute', fofo: 'cute', fofa: 'cute', oscuro: 'dark', escuro: 'dark',
  // The words that say which meaning another word has (`rosa jardin` is the flower, `llama fuego` is the flame).
  jardin: 'garden', jardim: 'garden', ramo: 'bouquet', petalos: 'petals', petalas: 'petals', fuego: 'fire', fogo: 'fire', arbol: 'tree', arvore: 'tree', fruta: 'fruit', jugo: 'juice', zumo: 'juice', suco: 'juice',
  isla: 'island', ilha: 'island', lago: 'lake', rio: 'river', coche: 'car', carro: 'car', auto: 'car', pelo: 'hair', cabello: 'hair', cabelo: 'hair', vestido: 'dress', nube: 'clouds', nubes: 'clouds', nuvem: 'clouds', nuvens: 'clouds',
  galaxia: 'galaxy', espacio: 'space', espaco: 'space', papel: 'paper', tinta: 'ink', madera: 'wood', madeira: 'wood', herramienta: 'tool', ferramenta: 'tool', pez: 'fish', peces: 'fish', peixe: 'fish', arrecife: 'reef', recife: 'reef',
  oceano: 'ocean', piedra: 'stone', pedra: 'stone', joya: 'jewelry', joia: 'jewelry', anillo: 'ring', anel: 'ring', campo: 'field', parque: 'park', calle: 'street', rua: 'street', edificio: 'building', predio: 'building', dinero: 'money', dinheiro: 'money',
  juguete: 'toy', brinquedo: 'toy', mano: 'hand', mao: 'hand', reloj: 'watch', relogio: 'watch', pulsera: 'bracelet', pulseira: 'bracelet', computadora: 'computer', ordenador: 'computer', computador: 'computer', teclado: 'keyboard', escritorio: 'desk',
  viento: 'wind', vento: 'wind', barco: 'boat', luz: 'light', nieve: 'snow', alpes: 'alps', suiza: 'switzerland', suica: 'switzerland', italia: 'italy', animales: 'animals', animais: 'animals', selva: 'jungle', granja: 'farm', fazenda: 'farm', cueva: 'cave', caverna: 'cave',
};

// The colors, and how each place filters by them (a place without the color searches the word and needs it in the text of the picture).
const COLORS = {
  pink: { pixabay: 'pink', pexels: 'pink', unsplash: 'magenta', google: 'pink', wallhaven: 'ea4c88' },
  red: { pixabay: 'red', pexels: 'red', unsplash: 'red', google: 'red', wallhaven: 'cc0000' },
  orange: { pixabay: 'orange', pexels: 'orange', unsplash: 'orange', google: 'orange', wallhaven: 'ff9900' },
  yellow: { pixabay: 'yellow', pexels: 'yellow', unsplash: 'yellow', google: 'yellow', wallhaven: 'ffff00' },
  green: { pixabay: 'green', pexels: 'green', unsplash: 'green', google: 'green', wallhaven: '77cc33' },
  turquoise: { pixabay: 'turquoise', pexels: 'turquoise', unsplash: 'teal', google: 'teal', wallhaven: '66cccc' },
  blue: { pixabay: 'blue', pexels: 'blue', unsplash: 'blue', google: 'blue', wallhaven: '0066cc' },
  purple: { pixabay: 'lilac', pexels: 'violet', unsplash: 'purple', google: 'purple', wallhaven: '993399' },
  brown: { pixabay: 'brown', pexels: 'brown', google: 'brown', wallhaven: '663300' },
  black: { pixabay: 'black', pexels: 'black', unsplash: 'black', google: 'black', wallhaven: '000000' },
  white: { pixabay: 'white', pexels: 'white', unsplash: 'white', google: 'white', wallhaven: 'ffffff' },
  gray: { pixabay: 'gray', pexels: 'gray', google: 'gray', wallhaven: '999999' },
  gold: {}, silver: {},
};
// The colors that are also something else, once their meaning was chosen: `orange-color` is the color orange, searched as orange.
const COLOR_OF = { 'orange-color': 'orange', 'lime-color': 'green', 'coral-color': 'orange', 'salmon-color': 'pink', 'turquoise-color': 'turquoise', 'peach-color': 'orange', 'lavender-color': 'purple' };
const colorOf = (tag) => (COLORS[tag] ? tag : COLOR_OF[tag] ?? null);

// Other words a picture can have for a word that was asked (`flower` is also `floral` or `blossom`).
const ALSO = {
  flower: ['floral', 'blossom', 'bloom', 'flor'], cat: ['kitten', 'kitty'], dog: ['puppy'], sea: ['ocean'], gray: ['grey'], purple: ['violet', 'lilac'], pink: ['magenta'],
  rose: ['roses'], girl: ['woman'], boy: ['man'], wallpaper: ['background', 'desktop'], aesthetic: [], sky: ['clouds'],
};

/**
 * The words with more than one meaning that are common in pictures, in English, Spanish and Portuguese, and the meanings. A meaning is a tag of its own
 * (`rose-flower`: the first part is the word a picture must have, the rest helps the search) that is never asked about again. `with` lists the words that,
 * next to it, say which meaning it is; `color` is the meaning of a color, which is the one when another thing is named (`flor rosa` is a pink flower);
 * `withColors` is the one when another color is named (`rosa roja` is a red rose).
 */
const sense = (key, tag, more = {}) => ({ key, tag, ...more });
const FLOWER_WITH = ['garden', 'bouquet', 'petals', 'petal', 'bloom', 'blossom', 'roses', 'thorns', 'vase'];
const SENSES = {
  rosa: [sense('flower', 'rose-flower', { with: FLOWER_WITH, withColors: true }), sense('color', 'pink', { color: true }), sense('mountain', 'monte-rosa', { with: ['mountain', 'mountains', 'snow', 'alps', 'glacier', 'switzerland', 'italy', 'hiking', 'peak'] })],
  rose: [sense('flower', 'rose-flower', { with: FLOWER_WITH, withColors: true }), sense('color', 'pink', { color: true })],
  naranja: [sense('fruit', 'orange-fruit', { with: ['fruit', 'juice', 'food', 'citrus', 'slice', 'tree'], withColors: true }), sense('color', 'orange-color', { color: true })],
  laranja: [sense('fruit', 'orange-fruit', { with: ['fruit', 'juice', 'food', 'citrus', 'slice', 'tree'], withColors: true }), sense('color', 'orange-color', { color: true })],
  orange: [sense('fruit', 'orange-fruit', { with: ['fruit', 'juice', 'food', 'citrus', 'slice', 'tree'], withColors: true }), sense('color', 'orange-color', { color: true })],
  violeta: [sense('flower', 'violet-flower', { with: FLOWER_WITH, withColors: true }), sense('color', 'purple', { color: true })],
  violet: [sense('flower', 'violet-flower', { with: FLOWER_WITH, withColors: true }), sense('color', 'purple', { color: true })],
  lavanda: [sense('flower', 'lavender-flower', { with: [...FLOWER_WITH, 'field', 'fields'], withColors: true }), sense('color', 'lavender-color', { color: true })],
  lavender: [sense('flower', 'lavender-flower', { with: [...FLOWER_WITH, 'field', 'fields'], withColors: true }), sense('color', 'lavender-color', { color: true })],
  lima: [sense('fruit', 'lime-fruit', { with: ['fruit', 'juice', 'food', 'citrus', 'slice'], withColors: true }), sense('color', 'lime-color', { color: true }), sense('city', 'lima-peru', { with: ['peru', 'city', 'street', 'night'] })],
  lime: [sense('fruit', 'lime-fruit', { with: ['fruit', 'juice', 'food', 'citrus', 'slice'], withColors: true }), sense('color', 'lime-color', { color: true })],
  coral: [sense('reef', 'coral-reef', { with: ['reef', 'sea', 'ocean', 'underwater', 'fish'], withColors: true }), sense('color', 'coral-color', { color: true })],
  salmon: [sense('fish', 'salmon-fish', { with: ['fish', 'food', 'sushi', 'river'], withColors: true }), sense('color', 'salmon-color', { color: true })],
  turquesa: [sense('stone', 'turquoise-stone', { with: ['stone', 'gem', 'jewelry', 'ring'], withColors: true }), sense('color', 'turquoise-color', { color: true })],
  turquoise: [sense('stone', 'turquoise-stone', { with: ['stone', 'gem', 'jewelry', 'ring'], withColors: true }), sense('color', 'turquoise-color', { color: true })],
  durazno: [sense('fruit', 'peach-fruit', { with: ['fruit', 'food', 'tree'], withColors: true }), sense('color', 'peach-color', { color: true })],
  melocoton: [sense('fruit', 'peach-fruit', { with: ['fruit', 'food', 'tree'], withColors: true }), sense('color', 'peach-color', { color: true })],
  pessego: [sense('fruit', 'peach-fruit', { with: ['fruit', 'food', 'tree'], withColors: true }), sense('color', 'peach-color', { color: true })],
  peach: [sense('fruit', 'peach-fruit', { with: ['fruit', 'food', 'tree'], withColors: true }), sense('color', 'peach-color', { color: true })],
  llama: [sense('llama', 'llama-animal', { with: ['animal', 'animals', 'andes', 'peru', 'farm', 'cute'] }), sense('flame', 'flame-fire', { with: ['fire', 'candle', 'burning', 'campfire', 'night'] })],
  vela: [sense('candle', 'candle', { with: ['fire', 'light', 'night', 'cozy'] }), sense('sail', 'sailboat', { with: ['sea', 'boat', 'ocean', 'beach', 'wind'] })],
  cometa: [sense('kite', 'kite', { with: ['wind', 'beach', 'park', 'children'] }), sense('comet', 'comet', { with: ['sky', 'space', 'night', 'stars'] })],
  mono: [sense('monkey', 'monkey', { with: ['animal', 'animals', 'jungle', 'forest', 'zoo'] }), sense('cute', 'cute'), sense('monochrome', 'monochrome')],
  pluma: [sense('feather', 'feather', { with: ['bird', 'birds', 'white', 'soft'] }), sense('pen', 'pen-writing', { with: ['paper', 'writing', 'ink', 'letter'] })],
  sierra: [sense('mountains', 'mountain-range', { with: ['snow', 'landscape', 'forest', 'sunset', 'hiking'] }), sense('saw', 'saw-tool', { with: ['tool', 'tools', 'wood'] })],
  jaguar: [sense('animal', 'jaguar-animal', { with: ['jungle', 'animal', 'animals', 'forest', 'cat'] }), sense('car', 'jaguar-car', { with: ['car', 'cars', 'road', 'vintage'] })],
  mouse: [sense('animal', 'mouse-animal', { with: ['animal', 'animals', 'cute', 'field', 'cheese'] }), sense('computer', 'mouse-computer', { with: ['computer', 'desk', 'setup', 'gaming', 'keyboard'] })],
  raton: [sense('animal', 'mouse-animal', { with: ['animal', 'animals', 'cute', 'field', 'cheese'] }), sense('computer', 'mouse-computer', { with: ['computer', 'desk', 'setup', 'gaming', 'keyboard'] })],
  rato: [sense('animal', 'mouse-animal', { with: ['animal', 'animals', 'cute', 'field', 'cheese'] }), sense('computer', 'mouse-computer', { with: ['computer', 'desk', 'setup', 'gaming', 'keyboard'] })],
  bat: [sense('animal', 'bat-animal', { with: ['animal', 'animals', 'night', 'cave', 'halloween'] }), sense('baseball', 'bat-baseball', { with: ['baseball', 'sport', 'ball'] })],
  apple: [sense('fruit', 'apple-fruit', { with: ['fruit', 'food', 'tree', 'juice'], withColors: true }), sense('brand', 'apple-logo', { with: ['iphone', 'mac', 'logo', 'phone', 'computer'] })],
  banco: [sense('bench', 'bench', { with: ['park', 'garden', 'autumn', 'street'] }), sense('bank', 'bank-building', { with: ['money', 'city', 'building'] })],
  muneca: [sense('doll', 'doll', { with: ['toy', 'toys', 'cute', 'porcelain'] }), sense('wrist', 'wrist', { with: ['hand', 'watch', 'bracelet'] })],
};

// What a feed of pictures never posts: a server follows these tags to decorate a channel, not for what is not for everybody.
const REFUSED = /^(?:nsfw|nude|nudes|naked|nudity|porn|porno|xxx|sex|sexy|erotic|erotica|lingerie|topless|bikini|fetish|boudoir|adult|gore|desnudo|desnuda|desnudos|sexo|erotico|nu|nua|pelada|pelado)$/;

const isAnime = (tag) => ANIME.has(tag);
// Names that are only found drawn (the characters of Sanrio, Pokémon...): asking for them goes to the places of drawings, as `anime` does, and the word stays in the search.
const DRAWN = new Set(['sanrio', 'cinnamoroll', 'kuromi', 'pompompurin', 'pochacco', 'chiikawa', 'totoro', 'pikachu', 'pokemon', 'vocaloid', 'miku', 'genshin', 'touhou']);
const isDrawn = (tag) => ANIME.has(tag) || DRAWN.has(tag);
// The tags that are the meaning of a word with several (`rose-flower`): only their first part is the word of a picture; any other tag with a dash is one name (`hello-kitty`).
const SENSE_TAGS = new Set(Object.values(SENSES).flat().map((each) => each.tag));
const headOf = (tag) => String(tag).split('-')[0];
const partsOf = (tag) => String(tag).split('-').filter(Boolean);

/** The words of a text: lower case, without accents or signs, two to 24 letters. */
function wordsOf(text) {
  return strip(text).split(/[\s,+;#]+/).map((word) => word.replace(/[^a-z0-9-]/g, '')).filter((word) => word.length >= 2 && word.length <= 24);
}

/** The meaning of a word with several, when the other words say which one (or null). `others` are the other tags, already in English. */
function senseFromContext(senses, others) {
  const named = others.filter((tag) => !STYLE.has(tag));
  for (const each of senses) if (each.with && named.some((tag) => each.with.includes(tag) || each.with.includes(headOf(tag)))) return each;
  const colors = named.filter((tag) => colorOf(tag));
  const things = named.filter((tag) => !colorOf(tag));
  if (colors.length) { const thing = senses.find((each) => each.withColors); if (thing) return thing; }
  if (things.length) { const color = senses.find((each) => each.color); if (color) return color; }
  return null;
}

/**
 * What a person wrote for a feed of pictures, read: `{ tags, ambiguous }`. `tags` are up to four, in English (the common Spanish and Portuguese words
 * are turned into the English ones), with `anime` when a word asks for anime. `ambiguous` is `{ word, senses: [{ key, tag }] }` when a word has several
 * meanings and the others do not say which one (its first meaning is in `tags` meanwhile).
 */
function parseQuery(text) {
  const all = wordsOf(text);
  // A word with a dash before it (`-character`) is a word the pictures must not have; it goes along the tags with its dash.
  const without = [];
  const words = [];
  for (const word of all) {
    if (/^-[a-z0-9]/.test(word)) {
      const bare = word.slice(1);
      const tag = `-${ANIME.has(bare) ? 'anime' : TRANSLATIONS[bare] ?? bare}`;
      if (tag !== '-anime' && !without.includes(tag)) without.push(tag);
    } else words.push(word.replace(/^-+/, ''));
  }
  const plain = words.map((word) => (ANIME.has(word) ? 'anime' : TRANSLATIONS[word] ?? word));
  const tags = [];
  let ambiguous = null;
  words.forEach((word, index) => {
    let tag = plain[index];
    const senses = SENSES[word];
    if (senses) {
      const chosen = senseFromContext(senses, plain.filter((_, other) => other !== index));
      if (chosen) tag = chosen.tag;
      else { ambiguous ??= { word, senses: senses.map(({ key, tag: each }) => ({ key, tag: each })) }; tag = senses[0].tag; }
    }
    if (!tags.includes(tag)) tags.push(tag);
  });
  return { tags: [...tags.slice(0, MAX_TAGS), ...without.slice(0, MAX_NOT)], ambiguous };
}

/** The tags of what a person wrote (see `parseQuery`). */
const parseTags = (text) => parseQuery(text).tags;

const isNot = (tag) => String(tag).startsWith('-');
/** The tags that are asked for, and the words that are not wanted (without the dash). */
const wantedOf = (tags) => tags.filter((tag) => !isNot(tag));
const unwantedOf = (tags) => tags.filter(isNot).map((tag) => tag.slice(1));
// Words that mean "no people in the picture" (`-character`, `-girl`): a booru is asked to leave out the tags of a person (`no_humans` is too strict: few pictures have it).
const NO_PEOPLE_TAGS = ['-1girl', '-1boy', '-multiple_girls', '-2girls', '-girl', '-boy', '-face', '-2boys', '-multiple_boys']; // the most useful first: a booru takes only so many tags
const PEOPLE = new Set(['character', 'characters', 'person', 'people', 'human', 'humans', 'girl', 'girls', 'boy', 'boys', 'woman', 'women', 'man', 'men', 'face', 'faces']);

// Memes: pictures of the funny kind, from the animal communities of Reddit (through meme-api.com, no key): `cat memes`, `dog meme`, or only `memes` for any animal.
const MEME_WORDS = new Set(['meme', 'memes']);
const isMeme = (tag) => MEME_WORDS.has(tag);
const MEME_PLACES = [[['cat', 'cats', 'kitten', 'kittens', 'kitty'], ['catmeme', 'cat_memes', 'catmemes']], [['dog', 'dogs', 'puppy', 'puppies', 'doggo'], ['dogmeme', 'dogmemes']]];
const MEME_ANY = ['AnimalMemes', 'catmeme', 'dogmeme']; // each one gives only a few different pictures, so several are asked
const memePlaces = (tags) => MEME_PLACES.find(([words]) => tags.some((tag) => words.includes(tag)))?.[1] ?? MEME_ANY;
const used = new Map(); // the pictures that were posted of the places that give different ones every time (memes): the ones not posted yet go first
const markUsed = (image) => { used.delete(image); used.set(image, true); if (used.size > 600) used.delete(used.keys().next().value); };

const refused = (tags) => wantedOf(tags).some((tag) => partsOf(tag).some((part) => REFUSED.test(part)) || REFUSED.test(tag));

/** `pink+cat` (the part of the account that says which tags). */
const joinTags = (tags) => tags.join('+');
const tagsOf = (accountId) => String(accountId ?? '').split(':').slice(2).join(':').split('+').filter(Boolean);

/** How a tag is shown: `rose-flower` is "rose flower". */
const tagLabel = (tag) => partsOf(tag).join(' ');
/** What is searched, to show: `pink · flower · anime style` (`animeLabel` is "anime style" in the language of the server). */
function queryLabel(tags, animeLabel = 'anime style') { // i18n-ignore: the English default, the card and the account pass the words of the server
  const things = wantedOf(tags).filter((tag) => !isAnime(tag)).map(tagLabel);
  return [...things, ...(tags.some(isAnime) ? [animeLabel] : []), ...unwantedOf(tags).map((word) => `-${word}`)].join(' · ');
}

const kept = new Map(); // words -> { until, items }
const KEEP_MS = 30 * 60_000; // a list of pictures is kept this long: the order of the pictures does not change while it is kept, so the pictures of the slots never repeat
const slots = new Map(); // `${tags}:${slot}` -> item | null

const https = (url) => (/^https:\/\/[^\s]+$/i.test(String(url ?? '')) && String(url).length <= MAX_IMAGE_URL ? String(url) : null);
const clip = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const encode = encodeURIComponent;
/** A tag as a booru writes it: one word, the plural taken off (`roses` is `rose`). */
const booruTag = (word) => word.replace(/ies$/, 'y').replace(/([^s])s$/, '$1').replace(/[^a-z0-9_]/g, '');

/**
 * What one place is asked for the tags: `words` to search (every part of every tag, without the anime word; the color is left out of `words` when the
 * place filters by it), `color` (what the place calls the color, or null), `nouns` (the tags that are not colors or the anime word).
 */
function planFor(source, tags) {
  const content = wantedOf(tags).filter((tag) => !isAnime(tag));
  const color = content.map(colorOf).find(Boolean) ?? null;
  const filter = color && source.colorKey ? COLORS[color]?.[source.colorKey] ?? null : null;
  const colorTag = content.find((tag) => colorOf(tag) === color);
  const searched = content.filter((tag) => !(filter && tag === colorTag));
  const words = [...new Set(searched.flatMap((tag) => (colorOf(tag) ? [colorOf(tag)] : partsOf(tag))))];
  if (!words.length && color) words.push(color); // only a color: it is also the word searched
  const nouns = content.filter((tag) => !colorOf(tag));
  return { words, color: filter, colorName: filter ? color : null, nouns, colorWord: color, not: unwantedOf(tags) };
}

/**
 * The searches a booru is asked for the plan, the most exact first (a booru tags a pink flower `pink_flower`). A name that is one tag (`hello-kitty`) is written
 * as the booru writes it (`hello_kitty`); the tag of a meaning (`rose-flower`) is only its first word. With nothing to search, the empty search: the best of the place.
 */
function booruTries(plan) {
  const nouns = plan.nouns.map((tag) => (SENSE_TAGS.has(tag) ? booruTag(headOf(tag)) : booruTag(tag.replace(/-/g, '_')))).filter(Boolean);
  const color = plan.colorWord ? booruTag(plan.colorWord) : null;
  const tries = [];
  if (color && nouns.length === 1) tries.push([`${color}_${nouns[0]}`]);
  if (color) tries.push([...nouns, `${color}_theme`]);
  tries.push(color ? [...nouns, color] : nouns);
  // What must not be there: a person (`-character`, `-girl`...) leaves out the tags of a person; any other word is a tag with a dash before it.
  const out = [...new Set(plan.not.flatMap((word) => (PEOPLE.has(word) ? NO_PEOPLE_TAGS : [`-${booruTag(word)}`])).filter((tag) => tag !== '-'))];
  return tries.map((each) => [...each, ...out]);
}

/** The pictures of a Moebooru site (Konachan, Yande.re), safe only, the best scored first: up to two pages of a hundred for each search. */
async function moebooru(host, plan) {
  const found = [];
  let failure = null; // one search that fails (a booru is busy) does not leave out the others
  for (const asked of booruTries(plan)) {
    // A Moebooru site takes at most six tags (the ones that leave something out are the first to go).
    const tags = [...asked.filter((tag) => !tag.startsWith('-')), ...asked.filter((tag) => tag.startsWith('-'))].slice(0, 6);
    for (let page = 1; page <= 2; page += 1) {
      const list = await fetchJsonBody(`${host}/post.json?limit=100&page=${page}&tags=${encode([...tags, 'rating:safe', 'order:score'].join(' '))}`).catch((error) => { failure ??= error; return null; });
      for (const entry of Array.isArray(list) ? list : []) {
        if (!entry || entry.rating !== 's') continue;
        // The sample is a jpg that Discord shows fast; a file over 8 MB without one is left out.
        const image = entry.sample_url || entry.jpeg_url || (Number(entry.file_size) < 8_000_000 ? entry.file_url : null);
        found.push({ image: https(image), url: https(`${host}/post/show/${entry.id}`), author: '', text: String(entry.tags ?? '').replace(/_/g, ' '), size: Math.max(Number(entry.width) || 0, Number(entry.height) || 0), from: String(entry.source ?? '') });
      }
      if (!Array.isArray(list) || list.length < 100) break;
    }
    if (found.length >= POOL) break;
  }
  if (!found.length && failure) throw failure;
  return found;
}

// Each source gives `[{ image, url, author, text }]` for a plan, or throws when it cannot answer. `needs` says what it has to have: a key, or nothing.
// `text` is what the place says of the picture (its tags, title, description), where the words asked are looked for; `trusted` places only give what has
// every word asked (their search requires them). `rehost`: its links expire or refuse other sites, so the picture is sent as a file.
const SOURCES = [
  {
    name: 'Konachan', anime: true, trusted: true, needs: () => true, // i18n-ignore: the name of a service
    // konachan.net only has pictures for everybody. Moebooru gives the best scored first, a hundred a page.
    search: (plan, tags) => moebooru('https://konachan.net', plan, tags),
  },
  {
    name: 'Yande.re', anime: true, trusted: true, needs: () => true, // i18n-ignore: the name of a service
    search: (plan, tags) => moebooru('https://yande.re', plan, tags),
  },
  {
    name: 'Safebooru', anime: true, needs: () => true, // i18n-ignore: the name of a service
    async search(plan) {
      const found = [];
      let failure = null;
      for (const tags of booruTries(plan)) {
        for (let page = 0; page < 2; page += 1) {
          const data = await fetchJsonBody(`https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=100&pid=${page}${tags.length ? `&tags=${encode(tags.join(' '))}` : ''}`).catch((error) => { failure ??= error; return null; });
          const list = (Array.isArray(data) ? data : []).filter((entry) => entry && entry.rating !== 'questionable' && entry.rating !== 'explicit');
          for (const entry of list) {
            // A huge picture without a sample (a png of many megabytes) is left out: Discord may not show it.
            if (!entry.sample_url && !entry.sample && Math.max(Number(entry.width) || 0, Number(entry.height) || 0) > 3000) continue;
            // A big picture has a sample (a smaller jpg) that Discord shows faster; the rest are shown as they are.
            const image = entry.sample_url ?? (entry.sample ? `https://safebooru.org/samples/${entry.directory}/sample_${String(entry.image).replace(/\.[a-z0-9]+$/i, '')}.jpg` : `https://safebooru.org/images/${entry.directory}/${entry.image}`);
            found.push({ image: https(image), url: https(`https://safebooru.org/index.php?page=post&s=view&id=${entry.id}`), author: '', text: String(entry.tags ?? '').replace(/_/g, ' '), size: Math.max(Number(entry.width) || 0, Number(entry.height) || 0), from: String(entry.source ?? '') });
          }
          if (list.length < 100) break;
        }
        if (found.length >= POOL) break;
      }
      if (!found.length && failure) throw failure;
      return found;
    },
  },
  {
    name: 'Wallhaven', anime: true, trusted: true, colorKey: 'wallhaven', needs: () => true, // i18n-ignore: the name of a service
    async search(plan, tags) {
      // `+word` must be in the picture; the other parts of a tag only help.
      const query = wantedOf(tags).filter((tag) => !isDrawn(tag) && !(plan.color && colorOf(tag) === plan.colorName)).map((tag) => (colorOf(tag) ? `+${colorOf(tag)}` : partsOf(tag).map((part, i) => (i ? part : `+${part}`)).join(' '))).concat(plan.not.map((word) => `-${word}`)).join(' ');
      const found = [];
      for (let page = 1; page <= 2; page += 1) {
        const data = await fetchJsonBody(`https://wallhaven.cc/api/v1/search?q=${encode(query)}&categories=010&purity=100&sorting=relevance&atleast=1280x720&page=${page}${plan.color ? `&colors=${plan.color}` : ''}`);
        for (const entry of data?.data ?? []) found.push({ image: https(entry.path), url: https(entry.url), author: '', text: '', size: Math.max(Number(entry.dimension_x) || 0, Number(entry.dimension_y) || 0) });
        if (page >= Number(data?.meta?.last_page ?? 1)) break;
      }
      return found;
    },
  },
  {
    name: 'Memes', memes: true, trusted: true, needs: () => true, // i18n-ignore: the name of a service
    // meme-api.com gives fifty random posts of a community each time: a few asks make a list; only pictures that are not marked adult or spoiler.
    async search(plan, tags) {
      const places = memePlaces(tags);
      const found = [];
      for (let ask = 0; ask < places.length * 2; ask += 1) {
        const data = await fetchJsonBody(`https://meme-api.com/gimme/${places[ask % places.length]}/50`).catch((error) => { if (!found.length && ask === places.length * 2 - 1) throw error; return null; });
        for (const entry of data?.memes ?? []) {
          if (!entry || entry.nsfw || entry.spoiler || !/\.(?:jpe?g|png|webp|gif)$/i.test(String(entry.url ?? ''))) continue;
          found.push({ image: https(entry.url), url: https(entry.postLink), author: '', text: clip(entry.title, 200), random: true });
        }
      }
      return found;
    },
  },
  {
    name: 'Google', rehost: true, colorKey: 'google', needs: () => Boolean(config.googleCseKey && config.googleCseCx), // i18n-ignore: the name of a service
    async search(plan) {
      const data = await fetchJsonBody(`https://www.googleapis.com/customsearch/v1?key=${encode(config.googleCseKey)}&cx=${encode(config.googleCseCx)}&q=${encode(plan.words.join(' '))}&searchType=image&safe=active&num=10&imgSize=large${plan.color ? `&imgDominantColor=${plan.color}` : ''}`);
      return (data?.items ?? []).map((entry) => ({ image: https(entry.link), url: https(entry.image?.contextLink), author: '', text: `${entry.title ?? ''} ${entry.snippet ?? ''}` }));
    },
  },
  {
    name: 'Pixabay', rehost: true, colorKey: 'pixabay', needs: () => Boolean(config.pixabayApiKey), // i18n-ignore: the name of a service
    async search(plan) {
      // Pixabay gives links for a day and asks not to show them from other sites: the picture goes as a file (`rehost`).
      const data = await fetchJsonBody(`https://pixabay.com/api/?key=${encode(config.pixabayApiKey)}&q=${encode(plan.words.join(' '))}&image_type=photo&safesearch=true&per_page=40&order=popular${plan.color ? `&colors=${plan.color}` : ''}`);
      return (data?.hits ?? []).map((entry) => ({ image: https(entry.largeImageURL), url: https(entry.pageURL), author: clip(entry.user, 80), text: String(entry.tags ?? '') }));
    },
  },
  {
    name: 'Pexels', colorKey: 'pexels', needs: () => Boolean(config.pexelsApiKey), // i18n-ignore: the name of a service
    async search(plan) {
      const data = await fetchJsonBody(`https://api.pexels.com/v1/search?query=${encode(plan.words.join(' '))}&per_page=40${plan.color ? `&color=${plan.color}` : ''}`, { headers: { Authorization: config.pexelsApiKey } });
      return (data?.photos ?? []).map((entry) => ({ image: https(entry.src?.large2x ?? entry.src?.large), url: https(entry.url), author: clip(entry.photographer, 80), text: String(entry.alt ?? '') }));
    },
  },
  {
    name: 'Unsplash', colorKey: 'unsplash', needs: () => Boolean(config.unsplashAccessKey), // i18n-ignore: the name of a service
    async search(plan) {
      const data = await fetchJsonBody(`https://api.unsplash.com/search/photos?query=${encode(plan.words.join(' '))}&per_page=30&content_filter=high${plan.color ? `&color=${plan.color}` : ''}`, { headers: { Authorization: `Client-ID ${config.unsplashAccessKey}` } });
      return (data?.results ?? []).map((entry) => ({ image: https(entry.urls?.regular), url: https(entry.links?.html), author: clip(entry.user?.name, 80), text: `${entry.alt_description ?? ''} ${entry.description ?? ''} ${(entry.tags ?? []).map((tag) => tag?.title ?? '').join(' ')}` }));
    },
  },
  {
    name: 'Openverse', rehost: true, needs: () => true, // i18n-ignore: the name of a service
    async search(plan) {
      // The pictures of Openverse are on the sites of who made them, some of which refuse other sites: the picture goes as a file (`rehost`).
      // Without a key Openverse answers at most 20 a page (it refused 30 with a 401, so it never gave a picture).
      const data = await fetchJsonBody(`https://api.openverse.org/v1/images/?q=${encode(plan.words.join(' '))}&page_size=20&mature=false&category=photograph,illustration`);
      return (data?.results ?? []).map((entry) => ({ image: https(entry.url), url: https(entry.foreign_landing_url), author: clip(entry.creator, 80), text: `${entry.title ?? ''} ${(entry.tags ?? []).map((tag) => tag?.name ?? '').join(' ')}` }));
    },
  },
  {
    name: 'Flickr', needs: () => true, // i18n-ignore: the name of a service
    async search(plan) {
      // Every word is a tag the picture must have (`tagmode=all`): a picture with only some of them is not what was asked.
      const items = (await fetchJsonBody(`${FEED}?tags=${encode(plan.words.join(','))}&tagmode=all&format=json&nojsoncallback=1`))?.items ?? [];
      // The feed gives the small picture: the large one has the same name with _b.
      return items.filter((entry) => /^https:\/\/www\.flickr\.com\//.test(entry?.link ?? '')).map((entry) => ({
        image: https(String(entry?.media?.m ?? '').replace(/_m\.(jpg|png|gif)$/i, '_b.$1')), url: https(entry.link),
        author: clip(String(entry.author ?? '').replace(/^nobody@flickr\.com \("?|"?\)$/g, ''), 80), text: `${entry.tags ?? ''} ${entry.title ?? ''}`,
      }));
    },
  },
];

/** The places to ask for a picture of those tags, best first: only the anime ones when a word asks for anime; otherwise the ones with a key, then the free ones. */
function sourcesFor(tags) {
  if (wantedOf(tags).some(isMeme)) return SOURCES.filter((source) => source.memes);
  const anime = tags.some(isDrawn);
  return SOURCES.filter((source) => source.needs() && !source.memes && (anime ? source.anime : !source.anime));
}

/** The words of a text, each one also without its plural, to look for the words asked. */
function textWords(text) {
  const words = new Set();
  for (const word of strip(text).split(/[^a-z0-9]+/).filter(Boolean)) {
    words.add(word);
    words.add(word.replace(/ies$/, 'y'));
    words.add(word.replace(/(?:es|s)$/, ''));
    words.add(word.replace(/s$/, ''));
  }
  return words;
}

/** Does a picture have every word asked? A color the place filtered by counts as there; a `trusted` place only gives what has them. */
function hasEveryTag(entry, tags, source, plan) {
  const words = textWords(entry.text);
  // A word that was left out (`-character`) is not in what the place says of the picture; for the people, any word of a person is not (their hair, a girl, a boy).
  const unwanted = unwantedOf(tags).flatMap((word) => (PEOPLE.has(word) ? ['girl', 'boy', 'woman', 'man', 'people', 'person', 'hair', '1girl', '1boy', '2girls'] : [word, word.replace(/s$/, '')]));
  if (unwanted.some((word) => words.has(word))) return false;
  if (source.trusted) return true;
  return wantedOf(tags).every((tag) => {
    if (isAnime(tag)) return true; // only anime places are asked for anime, and they have nothing else
    const color = colorOf(tag);
    if (color && plan.colorName === color) return true;
    const head = headOf(tag);
    const wanted = [head, head.replace(/s$/, ''), ...(ALSO[head] ?? []), ...(color ? [color, ...(ALSO[color] ?? [])] : [])];
    return wanted.some((word) => words.has(word));
  });
}

/** A number from a text, always the same (FNV-1a): what orders the pictures. */
function hashOf(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash;
}

const BIG = 900; // the longest side a drawing has to have to be preferred (a small one is only used when there are too few big ones)

/**
 * The pictures found for those tags, as `[{ image, url, author, source, rehost }]`, with no repeats and in an order that is always the same for those tags (a shuffle
 * that does not change while the list is kept): the pictures of the slots go one after the other along it, so a picture does not come again until all were posted.
 * Drawings are asked in every place until there are `POOL`; photos in each place until there are `WANTED`. Throws when no place had any and one failed, so the feed says so.
 */
async function latest(tags) {
  const key = tags.join(',');
  const cached = kept.get(key);
  if (cached && cached.until > Date.now()) return cached.items;
  const drawn = tags.some(isDrawn);
  const wanted = drawn ? POOL : WANTED;
  const items = [];
  const seen = new Set();
  let failure = null;
  for (const source of sourcesFor(tags)) {
    if (items.length >= wanted) break;
    const plan = planFor(source, tags);
    if (!plan.words.length && !source.anime) continue;
    try {
      for (const entry of await source.search(plan, tags)) {
        // The same picture is on several sites with the same source (its page on Pixiv): once.
        const same = entry.from && /^https?:\/\//.test(entry.from) ? `from:${entry.from}` : null;
        if (!entry.image || !entry.url || seen.has(entry.image) || (same && seen.has(same)) || !hasEveryTag(entry, tags, source, plan)) continue;
        seen.add(entry.image);
        if (same) seen.add(same);
        items.push({ image: entry.image, url: entry.url, author: entry.author, source: source.name, rehost: Boolean(source.rehost), size: Number(entry.size) || 0, random: Boolean(entry.random) });
      }
    } catch (error) {
      failure ??= error;
    }
  }
  if (!items.length && failure) throw failure;
  // Big drawings first choice; with few of them, all.
  const big = items.filter((item) => item.size >= BIG || !item.size);
  const chosen = (big.length >= 24 ? big : items).slice(0, POOL * 2);
  chosen.sort((a, b) => (Number(a.random && used.has(a.image)) - Number(b.random && used.has(b.image))) || hashOf(`${key}|${a.image}`) - hashOf(`${key}|${b.image}`));
  if (kept.size > 300) kept.clear();
  kept.set(key, { until: Date.now() + KEEP_MS, items: chosen });
  return chosen;
}

/** Are there pictures for those tags? True too when every place is down (the feed is not refused for that). */
async function hasAny(tags) {
  try { return (await latest(tags)).length > 0; } catch { return true; }
}

/**
 * The picture of a slot of time for those tags, the same for everybody; null when there is none. The picture is looked at before it is used (a page that
 * is not a picture, a link that is broken, an AVIF that Discord does not show): one that does not load is skipped for the next one.
 */
async function pictureOf(tags, key, at, { check = imageReady } = {}) {
  const id = `${tags.join('+')}:${key}`;
  if (slots.has(id)) return slots.get(id);
  const items = await latest(tags);
  // The slot number says which one: one after the other along the list, so two slots in a row never have the same picture.
  const slot = Math.abs(Number(String(key).split(':')[1]) || 0);
  let entry = null;
  const start = items.length ? slot % items.length : 0;
  for (let step = 0; step < Math.min(PROBES, items.length); step += 1) {
    const candidate = items[(start + step) % items.length];
    if (await check(candidate.image)) { entry = candidate; markUsed(candidate.image); break; }
  }
  const query = queryLabel(tags);
  // The title of the picture on its site (a file name, a caption in any language) is not shown: the notice says what was searched and where it was found.
  const item = entry ? {
    platform: 'pictures', type: 'photo', id: key, title: '', url: entry.url, description: '', image: entry.image, avatar: null, rehost: entry.rehost,
    author: entry.author, authorUrl: null, publishedAt: at, query: { tags }, source: entry.source, extra: `Searching: ${query} · ${entry.source}`, // i18n-ignore: the English line, the card writes it in the language of the server
  } : null;
  // A slot with no picture is not kept (the next look tries again), so one bad moment of the services does not leave the slot empty.
  if (!item) return null;
  if (slots.size > 300) slots.clear();
  slots.set(id, item);
  return item;
}

/** A tag that can be followed as a picture: every meaning of a word, to show and to choose (`ambiguous` from `parseQuery`). */
function choicesFor(text, ambiguous) {
  const words = String(text ?? '').split(/\s+/);
  return ambiguous.senses.map(({ key, tag }) => ({
    key, tag,
    // What to write to follow that meaning: the same text with the word replaced by the tag of the meaning.
    account: words.map((word) => (wordsOf(word)[0] === ambiguous.word ? tag : word)).join(' ').trim(),
  }));
}

/** The error of a word with several meanings: `choices` says them, for the command and the dashboard to ask which one. */
function ambiguousError(text, ambiguous) {
  const error = new IntegrationError('ambiguous', ambiguous.word);
  error.word = ambiguous.word;
  error.choices = choicesFor(text, ambiguous);
  return error;
}

module.exports = { hasWanted: (tags) => wantedOf(tags).length > 0, hasAny, parseQuery, parseTags, refused, joinTags, tagsOf, tagLabel, queryLabel, pictureOf, ambiguousError, choicesFor, hasEveryTag, planFor, SENSES, SOURCES, MAX_TAGS };
