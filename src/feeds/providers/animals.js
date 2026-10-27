// Pictures of cats, dogs and foxes (or any of them, `animals`), for the servers that want a bit of joy in a channel: one picture every so often (5 minutes to
// once a day), the same for every server that picked that pace. The services behind them are free and need no key; each slot of time is asked once, not once
// for each server. The notice never says where a picture comes from: it is only the picture.
const { fetchJsonBody } = require('../http');
const { t } = require('../../i18n');

const SOURCES = {
  cat: {
    async fetch() { const [cat] = await fetchJsonBody('https://api.thecatapi.com/v1/images/search'); return cat?.url ? { image: cat.url, link: cat.url } : null; },
  },
  dog: {
    async fetch() { const dog = await fetchJsonBody('https://dog.ceo/api/breeds/image/random'); return dog?.message ? { image: dog.message, link: dog.message } : null; },
  },
  fox: {
    async fetch() { const fox = await fetchJsonBody('https://randomfox.ca/floof/'); return fox?.image ? { image: fox.image, link: fox.image } : null; },
  },
};
const KINDS = ['cat', 'dog', 'fox'];

/** Which animal an `animals` slot shows: one of the three, a different one from slot to slot (the same for everybody). */
const kindOfSlot = (key) => KINDS[Math.abs(Number(String(key).split(':')[1]) || 0) % KINDS.length];

const slots = new Map(); // `${animal}:${key}` -> { image, link } | null
const keep = (key, value) => { if (slots.size > 100) slots.clear(); slots.set(key, value); return value; };

/** The picture of a slot of time for an animal (`cat`, `dog`, `fox` or `animals`, any of them), the same for everybody; null when the service has none. */
async function pictureOf(animal, key) {
  const id = `${animal}:${key}`;
  if (slots.has(id)) return slots.get(id);
  const kind = animal === 'animals' ? kindOfSlot(key) : animal;
  const found = await SOURCES[kind].fetch();
  return keep(id, found && /^https:\/\//i.test(found.image) ? { ...found, kind } : null);
}

/** The card item of a picture. */
const toItem = (animal, found, { id, at, lang }) => ({
  platform: animal, type: 'photo', id, title: t(lang, `feeds.animals.${animal === 'animals' ? found.kind : animal}`), url: found.link, description: '', image: found.image, avatar: null,
  author: null, authorUrl: null, publishedAt: at, extra: '',
});

module.exports = { pictureOf, toItem, SOURCES, KINDS };
