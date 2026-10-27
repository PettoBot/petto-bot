// Pictures of animals (cats, dogs, foxes, birds, ducks, capybaras, bunnies), or any of them (`animals`), for the servers that want a bit of joy in a channel: one
// picture every so often (5 minutes to once a day), the same for every server that picked that pace. Each animal has several free services (none needs a key);
// one is picked for each slot of time and, when it does not answer, the next one is tried. Each slot is asked once, not once for each server. The notice never
// says where a picture comes from: it is only the picture.
const { fetchJsonBody } = require('../http');
const { t } = require('../../i18n');

const upgrade = (url) => String(url ?? '').replace(/^http:\/\//i, 'https://');
const picture = (image) => (image ? { image: upgrade(image), link: upgrade(image) } : null);

const SOURCES = {
  cat: [
    async () => picture((await fetchJsonBody('https://api.thecatapi.com/v1/images/search'))?.[0]?.url),
    async () => picture((await fetchJsonBody('https://cataas.com/cat?json=true'))?.url),
    async () => picture((await fetchJsonBody('https://api.sefinek.net/api/v2/random/animal/cat'))?.message),
  ],
  dog: [
    async () => picture((await fetchJsonBody('https://dog.ceo/api/breeds/image/random'))?.message),
    async () => picture((await fetchJsonBody('https://api.thedogapi.com/v1/images/search'))?.[0]?.url),
    async () => picture((await fetchJsonBody('https://api.sefinek.net/api/v2/random/animal/dog'))?.message),
  ],
  fox: [
    async () => picture((await fetchJsonBody('https://randomfox.ca/floof/'))?.image),
    async () => picture((await fetchJsonBody('https://api.sefinek.net/api/v2/random/animal/fox'))?.message),
  ],
  bird: [
    async () => picture((await fetchJsonBody('https://api.sefinek.net/api/v2/random/animal/bird'))?.message),
  ],
  duck: [
    async () => picture((await fetchJsonBody('https://random-d.uk/api/v2/random'))?.url),
  ],
  capybara: [
    async () => picture((await fetchJsonBody('https://api.capy.lol/v1/capybara?json=true'))?.data?.url),
  ],
  bunny: [
    async () => picture((await fetchJsonBody('https://api.bunnies.io/v2/loop/random/?media=gif,png'))?.media?.poster),
  ],
};
const KINDS = Object.keys(SOURCES);

const slots = new Map(); // `${animal}:${key}` -> { image, link, kind } | null
const keep = (key, value) => { if (slots.size > 200) slots.clear(); slots.set(key, value); return value; };

/** A number that is the same for everybody in a slot of time (`30:123456`) and changes from one slot to the next. */
const seedOf = (key) => Math.abs(Number(String(key).split(':')[1]) || 0);

/** The picture of one animal: the service that comes up for the slot, then the others if it does not answer. */
async function fetchKind(kind, seed) {
  const list = SOURCES[kind];
  for (let step = 0; step < list.length; step += 1) {
    try {
      const found = await list[(seed + step) % list.length]();
      if (found && /^https:\/\//i.test(found.image)) return { ...found, kind };
    } catch { /* the next service */ }
  }
  return null;
}

/** The picture of a slot of time for an animal (one of `KINDS`, or `animals` for any of them), the same for everybody; null when no service has one. */
async function pictureOf(animal, key) {
  const id = `${animal}:${key}`;
  if (slots.has(id)) return slots.get(id);
  const seed = seedOf(key);
  if (animal !== 'animals') return keep(id, await fetchKind(animal, seed));
  // Any animal: the one of the slot, and the next ones if its services are down.
  for (let step = 0; step < KINDS.length; step += 1) {
    const found = await fetchKind(KINDS[(seed + step) % KINDS.length], Math.floor(seed / KINDS.length));
    if (found) return keep(id, found);
  }
  return keep(id, null);
}

/** The card item of a picture. */
const toItem = (animal, found, { id, at, lang }) => ({
  platform: animal, type: 'photo', id, title: t(lang, `feeds.animals.${animal === 'animals' ? found.kind : animal}`), url: found.link, description: '', image: found.image, avatar: null,
  author: null, authorUrl: null, publishedAt: at, extra: '',
});

module.exports = { pictureOf, toItem, SOURCES, KINDS };
