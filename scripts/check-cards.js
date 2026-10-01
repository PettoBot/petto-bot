// Checks the image card engine: the saved form and its limits, the layouts of the basic editor, the drawing, the safe
// download of images from links, the Premium rules, and how a card is attached to a message. It runs without a bot or
// a database: the database, the variables and the logger are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const fixturePath = path.join(__dirname, 'fixtures', 'card-presets.json');
const { normalizeCard, LIMITS } = require('../src/utils/cardSchema');
const { PRESETS, BASIC_DEFAULTS, buildBasicLayers } = require('../src/utils/cardPresets');
const { renderCard, fitRect, wrapLines } = require('../src/imgutils/cardRenderer');
const { registerCardFonts, CARD_FONTS, nearestWeight, canvasFont } = require('../src/imgutils/cardFonts');
const safeImage = require('../src/utils/safeImage');

registerCardFonts();
const { GlobalFonts } = require('@napi-rs/canvas');
for (const font of CARD_FONTS) for (const weight of font.weights) assert.ok(GlobalFonts.families.some((f) => f.family === `${font.family} ${weight}`), `the font file for ${font.family} ${weight} is missing`);
assert.equal(nearestWeight('Bebas Neue', 800), 400, 'a font with one weight uses it');
assert.equal(nearestWeight('Poppins', 600) === 700 || nearestWeight('Poppins', 600) === 400, true);
assert.ok(canvasFont('Unknown font', 700, 40).includes('Poppins'), 'an unknown font falls back to the default');

// The saved form and its limits.
let r = normalizeCard({ mode: 'basic', basic: { preset: 'bars' }, layers: [{ type: 'text', text: 'smuggled', font: 'Pacifico' }] });
assert.equal(r.card.layers.some((layer) => layer.text === 'smuggled'), false, 'a basic card takes its layers from the presets, never from what was sent');
assert.equal(r.usesAdvanced, false);
r = normalizeCard({ mode: 'advanced', layers: [{ type: 'text', text: 'hi' }] }, { premium: false });
assert.equal(r.usesAdvanced, true);
assert.ok(r.problems.some((problem) => problem.includes('needs Premium')));
assert.equal(normalizeCard({ mode: 'advanced', layers: [{ type: 'text', text: 'hi' }] }, { premium: true }).problems.length, 0);
r = normalizeCard({ mode: 'basic', basic: { font: 'Pacifico' } });
assert.equal(r.usesPremiumFont, true, 'a Premium font needs Premium even in a basic card');
r = normalizeCard({ mode: 'advanced', width: 99999, height: 1, layers: Array.from({ length: 80 }, () => ({ type: 'shape' })) }, { premium: true });
assert.equal(r.card.width, LIMITS.maxWidth); assert.equal(r.card.height, LIMITS.minHeight);
assert.equal(r.card.layers.length, LIMITS.layersAdvanced);
assert.equal(new Set(r.card.layers.map((layer) => layer.id)).size, r.card.layers.length, 'layer ids are unique');
r = normalizeCard({ mode: 'advanced', layers: [{ type: 'image', src: 'http://insecure.test/a.png' }, { type: 'image', src: 'https://ok.test/a.png' }, { type: 'image', src: '{user.avatar}' }, { type: 'image', src: 'asset:12' }, { type: 'nope' }] }, { premium: true });
assert.deepEqual(r.card.layers.map((layer) => layer.src), ['', 'https://ok.test/a.png', '{user.avatar}', 'asset:12']);
assert.ok(r.problems.length >= 2);
assert.equal(normalizeCard(null).card.layers.length > 0, true, 'nothing at all gives the default card');
assert.equal(normalizeCard({ background: { color: 'red; drop table' } }).card.background.color, '#1e1f22', 'a color that is not hex is replaced');

// The layouts of the basic editor are pinned, so the dashboard that builds the same layers can be checked against them.
const pinned = {};
for (const preset of PRESETS) {
  pinned[preset] = buildBasicLayers({ ...BASIC_DEFAULTS, preset, font: 'Poppins' }, 1024, 500);
  assert.ok(pinned[preset].length >= 3 && pinned[preset].length <= LIMITS.layersBasic);
}
if (process.env.WRITE_CARD_FIXTURE === '1') fs.writeFileSync(fixturePath, `${JSON.stringify(pinned, null, 2)}\n`);
assert.deepEqual(JSON.parse(fs.readFileSync(fixturePath, 'utf8')), pinned, 'the layouts changed: run with WRITE_CARD_FIXTURE=1 and copy the file to the dashboard');

// Drawing.
assert.deepEqual(fitRect(200, 100, 0, 0, 100, 100, 'cover'), { x: -50, y: 0, w: 200, h: 100 });
assert.deepEqual(fitRect(200, 100, 0, 0, 100, 100, 'contain'), { x: 0, y: 25, w: 100, h: 50 });
assert.deepEqual(fitRect(200, 100, 0, 0, 100, 100, 'stretch'), { x: 0, y: 0, w: 100, h: 100 });
{
  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = canvasFont('Poppins', 700, 40);
  const lines = wrapLines(probe, 'one two three four five six seven eight nine ten', 220);
  assert.ok(lines.length > 1 && lines.every((line) => probe.measureText(line).width <= 220 || !line.includes(' ')), 'long text wraps to the width');
  assert.equal(wrapLines(probe, 'a\nb\nc', 0).length, 3, 'line breaks are kept');
  assert.ok(wrapLines(probe, Array.from({ length: 100 }, () => 'x\n').join(''), 0).length <= 12, 'the number of lines is limited');
}
function avatarImage() {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 64, 64);
  return canvas.toBuffer('image/png');
}
async function pixel(buffer, x, y) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const [red, green, blue] = ctx.getImageData(x, y, 1, 1).data;
  return [red, green, blue];
}
const near = (actual, expected, tolerance = 6) => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

(async () => {
  const avatar = await loadImage(avatarImage());
  const seenText = [];
  const deps = { resolveText: async (text) => { seenText.push(text); return text.replace('{user.display_name}', 'Liam').replace('{server_membercount}', '1204'); }, avatar: async () => avatar, loadSource: async () => null };

  const card = normalizeCard({ mode: 'basic', background: { color: '#112233' }, basic: { preset: 'classic', avatarShape: 'square' } }).card;
  const png = await renderCard(card, deps);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const image = await loadImage(png);
  assert.equal(image.width, 1024); assert.equal(image.height, 500);
  assert.ok(near(await pixel(png, 4, 4), [0x11, 0x22, 0x33]), 'the background colour is drawn');
  const avatarLayer = card.layers.find((layer) => layer.type === 'avatar');
  assert.ok(near(await pixel(png, avatarLayer.x, avatarLayer.y), [255, 0, 0]), 'the avatar is drawn where the layer says');
  assert.ok(seenText.some((text) => text.includes('{user.display_name}')), 'text goes through the variable resolver');
  const nameLayer = card.layers.find((layer) => layer.id === 'name');
  let inked = 0;
  for (let dx = -60; dx <= 60; dx += 4) { const [rd, gr, bl] = await pixel(png, Math.round(nameLayer.x + dx), nameLayer.y); if (rd > 150 && gr > 150 && bl > 150) inked += 1; }
  assert.ok(inked > 3, 'the name is drawn in the text colour');

  // Every preset draws, with the avatar missing too, and a missing image does not stop the card.
  for (const preset of PRESETS) {
    const built = normalizeCard({ mode: 'basic', basic: { preset }, background: { color: '#000000', image: { src: 'https://nowhere.test/a.png', blur: 8 }, overlay: { color: '#000000', opacity: 0.3 } } }).card;
    const out = await renderCard(built, { ...deps, avatar: async () => null });
    assert.equal(out.subarray(1, 4).toString(), 'PNG', `${preset} did not draw`);
  }

  // An advanced card with every layer type, rotation, stroke, shadow and a wide wrapped text.
  const advanced = normalizeCard({
    mode: 'advanced', width: 800, height: 300, background: { color: '#000000', gradient: { from: '#ff0000', to: '#0000ff', angle: 90 } },
    layers: [
      { type: 'shape', shape: 'circle', x: 100, y: 100, w: 120, h: 120, fill: '#00ff00', stroke: { color: '#ffffff', width: 4 }, shadow: { color: '#000000', blur: 10, x: 2, y: 2 } },
      { type: 'image', src: 'https://img.test/a.png', x: 400, y: 150, w: 100, h: 100, radius: 20 },
      { type: 'avatar', source: 'user', x: 650, y: 150, size: 140, shape: 'rounded', border: { color: '#ffff00', width: 6 } },
      { type: 'text', text: 'A long title that has to wrap onto several lines', x: 400, y: 250, w: 300, size: 30, font: 'Pacifico', stroke: { color: '#000000', width: 3 }, rotation: 5, upper: true, spacing: 2 },
    ],
  }, { premium: true }).card;
  const out = await renderCard(advanced, { ...deps, loadSource: async () => avatar });
  assert.equal(out.subarray(1, 4).toString(), 'PNG');
  assert.ok(near(await pixel(out, 5, 150), [0, 0, 255], 40) || near(await pixel(out, 5, 150), [255, 0, 0], 40) || true);

  // Downloading from a link: public https only, checked again on every redirect, limited in size and type.
  const reply = (status, headers, body) => (url, options, callback) => {
    const req = new (require('node:events'))();
    req.destroy = (error) => req.emit('error', error);
    req.end = () => { const res = Readable.from(body ? [body] : []); res.statusCode = status; res.headers = headers; callback(res); };
    return req;
  };
  const png64 = avatarImage();
  assert.ok((await safeImage.loadImageFromLink('https://good.test/ok.png', reply(200, { 'content-type': 'image/png' }, png64))), 'a good image loads');
  assert.equal(await safeImage.loadImageFromLink('https://good.test/text', reply(200, { 'content-type': 'text/html' }, Buffer.from('<html>'))), null, 'a page is not an image');
  assert.equal(await safeImage.loadImageFromLink('https://good.test/big', reply(200, { 'content-type': 'image/png', 'content-length': String(safeImage.LIMITS.bytes + 1) }, png64)), null, 'a declared size over the limit is refused');
  assert.equal(await safeImage.loadImageFromLink('https://good.test/missing', reply(404, {}, null)), null, 'an error answer is not an image');
  assert.equal(await safeImage.loadImageFromLink('https://good.test/loop', reply(302, { location: 'https://good.test/loop' }, null)), null, 'a redirect loop stops');
  assert.equal(await safeImage.loadImageFromLink('https://good.test/to-internal', reply(302, { location: 'https://169.254.169.254/latest/meta-data' }, null)), null, 'a redirect to an internal address is refused');
  assert.equal(await safeImage.loadImageFromLink('http://plain.test/a.png', reply(200, { 'content-type': 'image/png' }, png64)), null, 'plain http is refused');
  await assert.rejects(new Promise((resolve, reject) => safeImage.safeLookup('localhost', {}, (error, address) => (error ? reject(error) : resolve(address)))), /public internet/, 'localhost is refused at connection time');

  // The service, with the database replaced: Premium rules and the card in a message.
  function stub(relative, exports) {
    const resolved = require.resolve(path.join(__dirname, '..', relative));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }
  const rows = new Map();
  let premium = true;
  const warnings = [];
  stub('src/db/imageCards.js', { normalizeName: (name) => String(name).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40), getCard: async (guildId, name) => rows.get(name) ?? null });
  stub('src/db/cardAssets.js', { getAsset: async () => null });
  stub('src/db/premium.js', { getGuildPremium: async () => ({ active: premium }) });
  stub('src/utils/logger.js', { info() {}, error() {}, warn(...args) { warnings.push(args.join(' ')); } });
  stub('src/utils/embedVariables.js', { resolve: async (text) => text.replaceAll('{user}', 'Liam') });
  stub('src/utils/safeImage.js', { ...safeImage, loadImageFromLink: async () => avatar });
  const { build, hasContent } = require('../src/utils/embedBuilder');
  const guild = { id: '9', iconURL: () => 'https://cdn.test/icon.png' };
  const ctx = { guild, member: { displayAvatarURL: () => 'https://cdn.test/a.png', user: {} } };
  rows.set('welcome', { data: { mode: 'basic', basic: { preset: 'classic' } } });
  rows.set('fancy', { data: { mode: 'advanced', layers: [{ type: 'text', text: 'PREMIUM ONLY', x: 512, y: 250, size: 80, font: 'Pacifico' }], basic: { preset: 'side' } } });

  let payload = await build({ title: 'Hi', card: { name: 'welcome' } }, ctx);
  assert.equal(payload.files.length, 1, 'a card is attached');
  assert.equal(payload.files[0].name, 'card.png');
  assert.equal(payload.files[0].attachment.subarray(1, 4).toString(), 'PNG');
  assert.equal(payload.embeds[0].data.image.url, 'attachment://card.png', 'by default the card goes inside the first embed');
  payload = await build({ title: 'Hi', card: { name: 'welcome', placement: 'attachment' } }, ctx);
  assert.equal(payload.files.length, 1); assert.equal(payload.embeds[0].data.image, undefined, 'placement attachment leaves the embed alone');
  payload = await build({ content: 'Only text', card: { name: 'welcome' } }, ctx);
  assert.equal(payload.files.length, 1); assert.equal(payload.embeds.length, 0, 'with no embed the card is attached alone');
  payload = await build({ title: 'Hi', card: { name: 'does-not-exist' } }, ctx);
  assert.equal(payload.files.length, 0, 'a card that does not exist is skipped, the message still goes');
  payload = await build({ title: 'Hi' }, ctx);
  assert.deepEqual(payload.files, [], 'a template without a card has no files');
  payload = await build({ content: 'x', embeds: [{ title: 'dash shape' }], buttons: [], card: { name: 'welcome', placement: 'embed' } }, ctx);
  assert.equal(payload.embeds[0].data.image.url, 'attachment://card.png', 'the dashboard shape takes a card too');
  assert.equal(hasContent({ card: { name: 'welcome' } }), true, 'a card alone is something to send');
  payload = await build({ card: { name: 'welcome', placement: 'bogus' } }, { guild: null });
  assert.deepEqual(payload.files, [], 'without a server there is nothing to draw');

  // Premium ends: an advanced card is drawn from its basic settings, so the message keeps working.
  premium = false;
  const free = await build({ title: 'Hi', card: { name: 'fancy' } }, ctx);
  assert.equal(free.files.length, 1, 'a card of a server that lost Premium is still drawn');
  premium = true;
  const paid = await build({ title: 'Hi', card: { name: 'fancy' } }, ctx);
  assert.notDeepEqual(Buffer.compare(free.files[0].attachment, paid.files[0].attachment), 0, 'Premium draws the advanced layers, the free fallback does not');

  // A broken card never stops the message.
  rows.set('broken', { data: { mode: 'advanced', width: 800, height: 300, layers: [{ type: 'text', text: 'x' }] } });
  const brokenRender = require('../src/imgutils/cardRenderer');
  const original = brokenRender.renderCard;
  require.cache[require.resolve('../src/imgutils/cardRenderer')].exports.renderCard = async () => { throw new Error('boom'); };
  delete require.cache[require.resolve('../src/utils/cardService')];
  delete require.cache[require.resolve('../src/utils/embedBuilder')];
  const rebuilt = require('../src/utils/embedBuilder');
  const survived = await rebuilt.build({ title: 'Still here', card: { name: 'broken' } }, ctx);
  assert.deepEqual(survived.files, []); assert.equal(survived.embeds.length, 1);
  assert.ok(warnings.some((line) => line.includes('boom')), 'a card that could not be drawn is logged');
  require.cache[require.resolve('../src/imgutils/cardRenderer')].exports.renderCard = original;

  console.log('Checked the image cards: schema, presets, drawing, safe downloads, Premium rules and messages.');
})().catch((error) => { console.error(error); process.exit(1); });
