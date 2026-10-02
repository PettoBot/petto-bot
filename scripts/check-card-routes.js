// Checks the dashboard routes of image cards with the database replaced: the Premium rules on save, the limits, the
// uploads (type, cleaning, size) and the preview.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { createCanvas } = require('@napi-rs/canvas');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const cards = new Map();
const assets = [];
let premium = false;
stub('src/utils/logger.js', { info() {}, error() {}, warn() {} });
stub('src/utils/embedVariables.js', { resolve: async (text) => text });
stub('src/db/premium.js', {
  FREE_LIMITS: {}, PREMIUM_LIMITS: {},
  getGuildPremium: async () => ({ active: premium }),
  getGuildLimits: (p) => (p?.active ? { imageCards: 30, cardAssets: 60 } : { imageCards: 2, cardAssets: 2 }),
});
stub('src/db/imageCards.js', {
  normalizeName: (n) => String(n ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40),
  listCards: async () => [...cards.entries()].map(([name, data]) => ({ name, data })),
  getCard: async (g, name) => (cards.has(name) ? { name, data: cards.get(name) } : null),
  countCards: async () => cards.size,
  saveCard: async (g, name, data) => { cards.set(name, data); return { name, data }; },
  deleteCard: async (g, name) => cards.delete(name),
});
stub('src/db/cardAssets.js', {
  listAssets: async () => assets.map(({ bytes, ...rest }) => rest),
  countAssets: async () => assets.length,
  totalBytes: async () => assets.reduce((sum, a) => sum + a.size, 0),
  getAsset: async (g, id) => assets.find((a) => String(a.id) === String(id)) ?? null,
  addAsset: async (g, a) => { const row = { id: assets.length + 1, size: a.bytes.length, created_at: 'now', ...a }; assets.push(row); return row; },
  deleteAsset: async (g, id) => { const i = assets.findIndex((a) => String(a.id) === String(id)); if (i < 0) return false; assets.splice(i, 1); return true; },
});
const { registerCardRoutes } = require('../src/web/cardRoutes');

function png(width, height) {
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
}
function call(port, method, url, { body, type } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: payload ? { 'content-type': type ?? 'application/json', 'content-length': payload.length } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, raw, json: res.headers['content-type']?.includes('json') ? JSON.parse(raw.toString()) : null });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  const guild = { id: '123456789012345678', iconURL: () => null };
  const member = { user: {}, displayAvatarURL: () => null };
  let allowed = true;
  registerCardRoutes(app, {
    authorize: async (req, res) => { if (!allowed) { res.status(403).json({ ok: false, error: 'no_access' }); return null; } return { guild, member, userId: '1' }; },
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ ok: false, error: 'failed' }));
  const server = app.listen(0);
  const port = server.address().port;
  const base = `/api/dashboard/cards/${guild.id}`;
  try {
    allowed = false;
    assert.equal((await call(port, 'GET', base)).status, 403, 'a person who cannot manage the server is refused');
    allowed = true;

    let r = await call(port, 'GET', base);
    assert.equal(r.json.premium, false); assert.equal(r.json.limits.cards, 2); assert.ok(r.json.fonts.some((f) => f.family === 'Pacifico' && f.premium));

    r = await call(port, 'POST', base, { body: { action: 'save', name: 'Welcome Card', data: { mode: 'basic', basic: { preset: 'bars' } } } });
    assert.equal(r.status, 200); assert.ok(cards.has('welcome_card'), 'the name is normalized');
    r = await call(port, 'POST', base, { body: { action: 'save', name: 'adv', data: { mode: 'advanced', layers: [{ type: 'text', text: 'x' }] } } });
    assert.equal(r.status, 402); assert.equal(r.json.error, 'premium_required'); assert.equal(cards.has('adv'), false);
    r = await call(port, 'POST', base, { body: { action: 'save', name: 'font', data: { mode: 'basic', basic: { font: 'Pacifico' } } } });
    assert.equal(r.status, 402, 'a Premium font in a basic card needs Premium');
    r = await call(port, 'POST', base, { body: { action: 'save', name: 'second', data: {} } });
    assert.equal(r.status, 200);
    r = await call(port, 'POST', base, { body: { action: 'save', name: 'third', data: {} } });
    assert.equal(r.status, 403); assert.equal(r.json.error, 'card_limit');
    r = await call(port, 'POST', base, { body: { action: 'save', name: 'second', data: { basic: { preset: 'panel' } } } });
    assert.equal(r.status, 200, 'saving an existing card is not blocked by the limit');
    r = await call(port, 'POST', base, { body: { action: 'save', name: '', data: {} } });
    assert.equal(r.status, 400);

    premium = true;
    r = await call(port, 'POST', base, { body: { action: 'save', name: 'adv', data: { mode: 'advanced', layers: [{ type: 'text', text: 'x', font: 'Pacifico' }] } } });
    assert.equal(r.status, 200); assert.equal(cards.get('adv').mode, 'advanced');
    premium = false;

    r = await call(port, 'POST', `${base}/preview`, { body: { data: { mode: 'basic', basic: { preset: 'side' } } } });
    assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'image/png'); assert.equal(r.raw.subarray(1, 4).toString(), 'PNG');
    r = await call(port, 'POST', `${base}/preview`, { body: { data: { mode: 'advanced', layers: [{ type: 'text', text: 'x' }] } } });
    assert.equal(r.status, 200, 'a free server previews an advanced card with the basic fallback, like a message would');

    r = await call(port, 'POST', `${base}/normalize`, { body: { data: { mode: 'basic', basic: { preset: 'bars' } } } });
    assert.equal(r.status, 200); assert.ok(r.json.card.layers.length >= 4, 'normalize gives the layers a basic card builds');
    r = await call(port, 'POST', `${base}/normalize`, { body: { data: { kind: 'rank', mode: 'basic' } } });
    assert.equal(r.json.card.kind, 'rank'); assert.ok(r.json.card.layers.some((layer) => layer.type === 'bar'), 'a rank card has its progress bar');
    r = await call(port, 'GET', base);
    assert.deepEqual(r.json.rankPresets, ['rank', 'rankBottom']);
    r = await call(port, 'POST', `${base}/assets?name=my%20pic.png`, { body: png(3000, 1000), type: 'image/png' });
    assert.equal(r.status, 200); assert.equal(r.json.asset.width, 2048, 'a large upload is scaled down'); assert.equal(r.json.asset.name, 'my pic.png');
    r = await call(port, 'POST', `${base}/assets`, { body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), type: 'image/svg+xml' });
    assert.equal(r.status, 415, 'svg is refused');
    r = await call(port, 'POST', `${base}/assets`, { body: Buffer.from('not an image'), type: 'image/png' });
    assert.equal(r.status, 400); assert.equal(r.json.error, 'not_an_image');
    r = await call(port, 'POST', `${base}/assets`, { body: Buffer.alloc(0), type: 'image/png' });
    assert.ok(r.status === 400, 'an empty file is refused');
    r = await call(port, 'POST', `${base}/assets`, { body: png(10, 10), type: 'image/png' });
    assert.equal(r.status, 200);
    r = await call(port, 'POST', `${base}/assets`, { body: png(10, 10), type: 'image/png' });
    assert.equal(r.status, 403); assert.equal(r.json.error, 'asset_limit');
    r = await call(port, 'POST', `${base}/assets`, { body: Buffer.alloc(6 * 1024 * 1024, 1), type: 'image/png' });
    assert.equal(r.status, 413, 'a file over the limit is refused');
    r = await call(port, 'GET', `${base}/assets/1`);
    assert.equal(r.status, 200); assert.equal(r.raw.subarray(1, 4).toString(), 'PNG');
    assert.equal((await call(port, 'GET', `${base}/assets/abc`)).status, 404);
    assert.equal((await call(port, 'DELETE', `${base}/assets/1`)).status, 200);
    assert.equal((await call(port, 'DELETE', `${base}/assets/1`)).status, 404);

    r = await call(port, 'POST', base, { body: { action: 'delete', name: 'second' } });
    assert.equal(r.status, 200);
    assert.equal((await call(port, 'POST', base, { body: { action: 'delete', name: 'second' } })).status, 404);
    console.log('Checked the image card dashboard routes: access, Premium rules, limits, uploads and preview.');
  } finally {
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
