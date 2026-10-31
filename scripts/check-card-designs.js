// Checks the designs that come with Petto for image cards: every design draws for every kind of card at its real size, has a name in the three
// languages, stays inside the weight budget, keeps the text readable (contrast measured on the drawn pixels where the text goes), and an
// unknown design falls back to the default one. `node scripts/check-card-designs.js --report` prints the contrast of every design.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/db/imageCards.js', { getCard: async () => null });
stub('src/db/cardAssets.js', { getAsset: async () => null });
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: false }) });
const designsApi = require('../src/utils/cardDesigns');
const { normalizeCard, source } = require('../src/utils/cardSchema');
const { renderCard } = require('../src/imgutils/cardRenderer');
const { drawCard } = require('../src/utils/cardService');
const { canvasFont, registerCardFonts } = require('../src/imgutils/cardFonts');
const { t, LANGUAGES } = require('../src/i18n');

const REPORT = process.argv.includes('--report');
const DIR = path.join(__dirname, '..', 'src', 'assets', 'backgrounds');
const LIMITS = { fileBytes: 120 * 1024, totalBytes: 4 * 1024 * 1024, thumbBytes: 20 * 1024, thumbWidth: 320 };
// Every layout of every kind of card, at the size the editor gives it.
const LAYOUTS = [
  { kind: 'welcome', preset: 'classic', width: 1024, height: 500 }, { kind: 'welcome', preset: 'side', width: 1024, height: 500 },
  { kind: 'welcome', preset: 'bars', width: 1024, height: 500 }, { kind: 'welcome', preset: 'panel', width: 1024, height: 500 },
  { kind: 'rank', preset: 'rank', width: 1024, height: 320 }, { kind: 'rank', preset: 'rankBottom', width: 1024, height: 320 },
  { kind: 'rank', preset: 'levelup', width: 1024, height: 240 },
];
// A long name is the worst case for where the text reaches. The contrast the text needs: 4.5 for the name and the lines, 3 for the big accent words.
const SAMPLE = { title: 'WELCOME', name: 'Liam Rodriguez', subtitle: 'We are now 1,204 members', extra: 'RANK #3' };
const MIN_TEXT = 4.5;
const MIN_ACCENT = 3;

const luminance = (r, g, b) => [r, g, b].reduce((sum, v, i) => { const s = v / 255; return sum + [0.2126, 0.7152, 0.0722][i] * (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4); }, 0);
const hexLum = (hex) => { const v = parseInt(hex.slice(1), 16); return luminance((v >> 16) & 255, (v >> 8) & 255, v & 255); };
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The card of a design for a layout, with nothing drawn but the background and the panels (no avatar, text or bar). */
function emptyCard(id, layout) {
  const settings = designsApi.designSettings(id);
  const { card } = normalizeCard({ kind: layout.kind, mode: 'basic', width: layout.width, height: layout.height, background: settings.background, basic: { preset: layout.preset, ...settings.basic } }, { premium: false });
  return card;
}

/** The lowest contrast of the text of a layout against the pixels behind it: the 90th brightest percent of each text box. */
async function measure(id, layout, deps) {
  const card = emptyCard(id, layout);
  const text = card.layers.filter((layer) => layer.type === 'text');
  const backdrop = { ...card, layers: card.layers.filter((layer) => layer.type === 'shape') };
  const image = await loadImage(await renderCard(backdrop, deps));
  const canvas = createCanvas(card.width, card.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const results = [];
  for (const layer of text) {
    const value = SAMPLE[layer.id];
    if (!value) continue;
    ctx.font = canvasFont(layer.font, layer.weight, layer.size);
    const shown = layer.upper ? value.toUpperCase() : value;
    const width = Math.min(layer.w || card.width, ctx.measureText(shown).width + (layer.spacing || 0) * shown.length);
    const left = layer.align === 'center' ? layer.x - width / 2 : layer.align === 'right' ? layer.x - width : layer.x;
    const x = Math.max(0, Math.floor(left)); const y = Math.max(0, Math.floor(layer.y - layer.size * 0.6));
    const w = Math.max(1, Math.min(card.width - x, Math.ceil(width))); const h = Math.max(1, Math.min(card.height - y, Math.ceil(layer.size * 1.2)));
    const data = ctx.getImageData(x, y, w, h).data;
    const values = [];
    for (let i = 0; i < data.length; i += 4) values.push(luminance(data[i], data[i + 1], data[i + 2]));
    values.sort((a, b) => a - b);
    const bright = values[Math.floor(values.length * 0.9)];
    const textLum = hexLum(layer.color);
    // Text that is lighter than the picture needs the picture dark; the contrast is against its brightest part.
    results.push({ id: layer.id, ratio: ratio(textLum, bright), needs: layer.color === card.basic?.accent && layer.id !== 'name' ? MIN_ACCENT : MIN_TEXT });
  }
  return results;
}

(async () => {
  registerCardFonts();
  const list = designsApi.designs();
  assert.ok(list.length >= 27, `at least 25 new designs and the two classic ones (found ${list.length})`);
  const families = new Set(list.map((design) => design.family));
  for (const family of ['animals', 'fruits', 'flowers', 'nature']) assert.ok(families.has(family), `the family ${family} has designs`);
  assert.equal(new Set(list.map((design) => design.id)).size, list.length, 'design ids are unique');

  let total = 0;
  for (const design of list) {
    assert.match(design.id, /^[a-z0-9-]{3,30}$/, `${design.id} is a valid id`);
    assert.equal(source(`petto:${design.id}`), `petto:${design.id}`, `${design.id} is a valid picture source`);
    assert.ok(designsApi.FAMILIES.includes(design.family), `${design.id} has a known family`);
    for (const lang of LANGUAGES) {
      const name = t(lang, `embeds.design.${design.id}`);
      assert.ok(name && !name.startsWith('embeds.design.'), `${design.id} has a name in ${lang}`);
    }
    for (const family of [design.family]) for (const lang of LANGUAGES) assert.ok(!t(lang, `embeds.designFamily.${family}`).startsWith('embeds.designFamily'), `family ${family} has a name in ${lang}`);
    const file = path.join(DIR, design.file);
    assert.ok(fs.existsSync(file), `${design.file} exists`);
    const size = fs.statSync(file).size;
    total += size;
    assert.ok(size <= LIMITS.fileBytes, `${design.file} weighs ${size} bytes, over the ${LIMITS.fileBytes} budget`);
    const thumb = fs.readFileSync(path.join(DIR, 'thumbs', `${design.id}.webp`));
    assert.ok(thumb.length <= LIMITS.thumbBytes, `the gallery picture of ${design.id} is small`);
    assert.equal((await loadImage(thumb)).width, LIMITS.thumbWidth, `the gallery picture of ${design.id} is ${LIMITS.thumbWidth} px wide`);
    for (const key of ['color', 'textColor', 'accent', 'panel']) assert.match(design[key], /^#[0-9a-f]{6}$/i, `${design.id} has a ${key}`);
  }
  assert.ok(total <= LIMITS.totalBytes, `the pictures weigh ${total} bytes, over the budget`);

  // Every design draws for every layout, through the same path a message takes, and its text is readable.
  const deps = { resolveText: async (value) => value, avatar: async () => null, loadSource: async (src) => designsApi.loadDesignImage(src.replace('petto:', '')) };
  const weak = [];
  for (const design of list) {
    // The two classic pictures were made for the default rank cards only.
    for (const layout of LAYOUTS.filter((one) => design.family !== 'classic' || one.kind === 'rank')) {
      const settings = designsApi.designSettings(design.id);
      const png = await drawCard({ kind: layout.kind, mode: 'basic', width: layout.width, height: layout.height, background: settings.background, basic: { preset: layout.preset, ...settings.basic } }, {}, { guildId: '1', premium: false });
      const picture = await loadImage(png);
      assert.deepEqual([picture.width, picture.height], [layout.width, layout.height], `${design.id} ${layout.preset} is drawn at ${layout.width}x${layout.height}`);
      for (const r of await measure(design.id, layout, deps)) {
        if (REPORT) console.log(`${design.id.padEnd(18)} ${layout.preset.padEnd(10)} ${r.id.padEnd(9)} ${r.ratio.toFixed(2)}`);
        if (r.ratio < r.needs) weak.push(`${design.id} ${layout.preset} ${r.id} ${r.ratio.toFixed(2)} (needs ${r.needs})`);
      }
    }
  }
  assert.deepEqual(weak, [], `text contrast is too low:\n${weak.join('\n')}`);

  // A design that is not there, or one that cannot be read, falls back to the default design and never throws.
  assert.equal(designsApi.resolveDesignId('petto-nope'), designsApi.FALLBACK.welcome);
  assert.equal(designsApi.resolveDesignId('../../etc/passwd', 'rank'), designsApi.FALLBACK.rank);
  assert.equal(designsApi.resolveDesignId(undefined), designsApi.FALLBACK.welcome);
  assert.equal(designsApi.designSettings('petto-nope'), null);
  const fallback = await designsApi.loadDesignImage('does-not-exist');
  assert.ok(fallback && fallback.width > 0, 'an unknown design gives the default picture');
  const unknown = await drawCard({ kind: 'welcome', mode: 'basic', background: { color: '#112233', image: { src: 'petto:no-such-design' } }, basic: {} }, {}, { guildId: '1', premium: false });
  assert.ok((await loadImage(unknown)).width === 1024, 'a card with an unknown design is still drawn');
  const dead = await drawCard({ kind: 'welcome', mode: 'basic', background: { color: '#112233', image: { src: 'asset:999' } }, basic: {} }, {}, { guildId: '1', premium: false });
  assert.ok((await loadImage(dead)).width === 1024, 'a card whose background picture is gone is still drawn');

  // Only a handful of pictures stay decoded.
  for (const design of list) await designsApi.loadDesignImage(design.id);
  assert.ok(designsApi.CACHE_SIZE <= 8, 'a small cache of decoded pictures');

  const catalog = designsApi.designCatalog();
  assert.equal(catalog.designs.length, list.length);
  assert.ok(catalog.designs.every((design) => LANGUAGES.every((lang) => design.names[lang])), 'the dashboard list has the three languages');
  assert.ok(designsApi.designFile(list[2].id, true).bytes.length > 100 && designsApi.designFile(list[2].id).bytes.length > 1000, 'the files are served');
  assert.equal(designsApi.designFile('nope'), null);
  console.log(`Checked ${list.length} card designs: every layout, names in ${LANGUAGES.length} languages, ${(total / 1024).toFixed(0)} KB in all, text contrast, and the fallback.`);
})().catch((error) => { console.error(error); process.exit(1); });
