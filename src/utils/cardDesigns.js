// The designs that come with Petto for image cards: a background picture (src/assets/backgrounds/<id>.webp, `petto:<id>` in a card) with its
// own colors for the text, so any name stays readable. The list (designs.json) is written by scripts/make-card-designs.js, which also
// draws the pictures; the names are in the embeds catalog (`embeds.design.<id>`, `embeds.designFamily.<family>`).
//
// A picture is read from disk only when a card that uses it is drawn, and only a handful stay decoded (a small LRU), so the whole set never
// sits in memory. An id that does not exist falls back to the default design and never throws.
const fs = require('node:fs');
const path = require('node:path');
const { decode } = require('./safeImage');
const { t, currentLanguage } = require('../i18n');

const DIR = path.join(__dirname, '..', 'assets', 'backgrounds');
const FAMILIES = ['classic', 'animals', 'fruits', 'flowers', 'nature'];
// What is drawn when a card asks for a design that is not there (or one that cannot be read): the default rank cards keep their own.
const FALLBACK = { welcome: 'nature-night', rank: 'rank-default' };
const CACHE_SIZE = 6;
const ID = /^[a-z0-9-]{3,30}$/;

let list = null;
function designs() {
  if (list) return list;
  try { list = JSON.parse(fs.readFileSync(path.join(DIR, 'designs.json'), 'utf8')); } catch { list = []; }
  return list;
}
const byId = () => new Map(designs().map((design) => [design.id, design]));

/** The design with this id, or null. */
function getDesign(id) { return typeof id === 'string' && ID.test(id) ? byId().get(id) ?? null : null; }

/** The id to draw for `id`: itself when it exists, otherwise the default design of the kind of card. */
function resolveDesignId(id, kind = 'welcome') { return getDesign(id) ? id : FALLBACK[kind === 'rank' ? 'rank' : 'welcome']; }

/** The designs for the dashboard and the commands: id, family, name in `lang`, colors and what they weigh. */
function listDesigns(lang = currentLanguage()) {
  return designs().map((design) => ({
    id: design.id, family: design.family, name: t(lang, `embeds.design.${design.id}`), color: design.color, textColor: design.textColor, accent: design.accent,
    panel: design.panel, ratio: design.ratio, bytes: design.bytes,
  }));
}
/** The gallery for the dashboard: the families and every design with its name in the three languages (the page picks the one it shows and searches in all). */
function designCatalog() {
  const langs = ['en', 'es', 'pt-BR'];
  const used = new Set(designs().map((design) => design.family));
  return {
    families: FAMILIES.filter((family) => used.has(family)).map((family) => ({ id: family, names: Object.fromEntries(langs.map((lang) => [lang, t(lang, `embeds.designFamily.${family}`)])) })),
    designs: designs().map((design) => ({
      id: design.id, family: design.family, names: Object.fromEntries(langs.map((lang) => [lang, t(lang, `embeds.design.${design.id}`)])),
      color: design.color, textColor: design.textColor, accent: design.accent, panel: design.panel, panelOpacity: design.panelOpacity, ratio: design.ratio,
    })),
  };
}
function familyName(family, lang = currentLanguage()) { return t(lang, `embeds.designFamily.${family}`); }

/** The settings a card takes when a design is chosen: the picture, its colors for the text and the tint of the panel behind it. */
function designSettings(id) {
  const design = getDesign(id);
  if (!design) return null;
  return {
    background: { color: design.color, gradient: null, image: { src: `petto:${design.id}`, fit: 'cover', blur: 0 }, overlay: null },
    basic: { textColor: design.textColor, accent: design.accent, panelColor: design.panel, ...(design.panelOpacity ? { panelOpacity: design.panelOpacity } : {}) },
  };
}

// The decoded pictures that were drawn last, a few at most. A picture that is loading is shared by the cards that ask for it at once.
const cache = new Map();
async function readImage(id) {
  const design = getDesign(id);
  if (!design) return null;
  try { return await decode(await fs.promises.readFile(path.join(DIR, design.file))); } catch { return null; }
}

/** The picture of a design (`petto:<id>`): the design itself, or the default one when it is unknown or cannot be read. Never throws. */
async function loadDesignImage(id, kind = 'welcome') {
  const wanted = resolveDesignId(id, kind);
  for (const name of wanted === FALLBACK[kind === 'rank' ? 'rank' : 'welcome'] ? [wanted] : [wanted, FALLBACK[kind === 'rank' ? 'rank' : 'welcome']]) {
    let pending = cache.get(name);
    if (pending) { cache.delete(name); cache.set(name, pending); } else {
      pending = readImage(name);
      cache.set(name, pending);
      while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    }
    const image = await pending;
    if (image) return image;
    cache.delete(name);
  }
  return null;
}

/** The bytes of the full picture or of the small gallery one for the dashboard, or null. */
function designFile(id, thumb = false) {
  const design = getDesign(id);
  if (!design) return null;
  try {
    return thumb
      ? { bytes: fs.readFileSync(path.join(DIR, 'thumbs', `${design.id}.webp`)), type: 'image/webp' }
      : { bytes: fs.readFileSync(path.join(DIR, design.file)), type: design.file.endsWith('.png') ? 'image/png' : 'image/webp' };
  } catch { return null; }
}

module.exports = { FAMILIES, FALLBACK, CACHE_SIZE, designs, getDesign, resolveDesignId, listDesigns, designCatalog, familyName, designSettings, loadDesignImage, designFile };
