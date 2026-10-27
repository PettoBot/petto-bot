// Pictures of cats and foxes, for the servers that want a bit of joy in a channel: one picture every so often (15 minutes to once a day), the same for
// every server that picked that pace. TheCatAPI and Random Fox are free and need no key; each slot of time is asked once, not once for each server.
const { fetchJsonBody } = require('../http');
const { t } = require('../../i18n');

const SOURCES = {
  cat: {
    name: 'TheCatAPI', url: 'https://thecatapi.com',
    async fetch() { const [cat] = await fetchJsonBody('https://api.thecatapi.com/v1/images/search'); return cat?.url ? { image: cat.url, link: cat.url } : null; },
  },
  fox: {
    name: 'Random Fox', url: 'https://randomfox.ca', // i18n-ignore: the name of a service
    async fetch() { const fox = await fetchJsonBody('https://randomfox.ca/floof/'); return fox?.image ? { image: fox.image, link: fox.link ?? fox.image } : null; },
  },
};

const slots = new Map(); // `${animal}:${key}` -> { image, link } | null
const keep = (key, value) => { if (slots.size > 100) slots.clear(); slots.set(key, value); return value; };

/** The picture of a slot of time for an animal (`cat` or `fox`), the same for everybody; null when the service has none. */
async function pictureOf(animal, key) {
  const id = `${animal}:${key}`;
  if (slots.has(id)) return slots.get(id);
  const found = await SOURCES[animal].fetch();
  return keep(id, found && /^https:\/\//i.test(found.image) ? found : null);
}

/** The card item of a picture. */
const toItem = (animal, found, { id, at, lang }) => ({
  platform: animal, type: 'photo', id, title: t(lang, `feeds.animals.${animal}`), url: found.link, description: '', image: found.image, avatar: null,
  author: SOURCES[animal].name, authorUrl: SOURCES[animal].url, publishedAt: at, extra: '',
});

module.exports = { pictureOf, toItem, SOURCES };
