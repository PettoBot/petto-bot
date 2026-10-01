// Dashboard routes for image cards: the list, saving with the Premium rules, a preview picture, and the pictures a
// server uploads. They sit behind the same dashboard key as the other dashboard routes, and every one checks that the
// person can manage the server.
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { normalizeCard } = require('../utils/cardSchema');
const { drawCard } = require('../utils/cardService');
const { decode } = require('../utils/safeImage');
const { CARD_FONTS } = require('../imgutils/cardFonts');
const { PRESETS } = require('../utils/cardPresets');
const imageCards = require('../db/imageCards');
const cardAssets = require('../db/cardAssets');
const { getGuildPremium, getGuildLimits } = require('../db/premium');
const logger = require('../utils/logger');

const UPLOAD = { bytes: 5 * 1024 * 1024, maxSide: 2048, storeFree: 15 * 1024 * 1024, storePremium: 120 * 1024 * 1024 };
// The limiter is built here, in the same file as the routes, so it is plain that every route is limited.
const cardLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ ok: false, error: 'rate_limited' }); },
});
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ ok: false, error: 'rate_limited' }); },
});
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function describeLimits(premium) {
  const limits = getGuildLimits({ active: premium });
  return { cards: limits.imageCards, assets: limits.cardAssets, storageBytes: premium ? UPLOAD.storePremium : UPLOAD.storeFree, uploadBytes: UPLOAD.bytes };
}

/** Re-draws an upload as a PNG so only pixels are kept: nothing hidden in the file is stored. Large pictures are scaled down. */
async function cleanUpload(buffer) {
  const image = await decode(buffer);
  const scale = Math.min(1, UPLOAD.maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  return { bytes: canvas.toBuffer('image/png'), width, height };
}

function registerCardRoutes(app, { authorize }) {
  const route = (handler) => async (req, res) => {
    const access = await authorize(req, res);
    if (!access) return;
    try {
      await handler(req, res, access);
    } catch (error) {
      logger.error({ guildId: req.params.guildId, action: 'card-route' }, `Image card request failed: ${error.message}`);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'card_unavailable' });
    }
  };

  app.get('/api/dashboard/cards/:guildId', cardLimiter, route(async (req, res) => {
    const guildId = req.params.guildId;
    const premium = (await getGuildPremium(guildId)).active;
    const [cards, assets, used] = await Promise.all([imageCards.listCards(guildId), cardAssets.listAssets(guildId), cardAssets.totalBytes(guildId)]);
    res.json({
      ok: true,
      premium,
      limits: describeLimits(premium),
      usage: { cards: cards.length, assets: assets.length, storageBytes: used },
      presets: PRESETS,
      fonts: CARD_FONTS.map((font) => ({ family: font.family, weights: font.weights, premium: font.tier === 'premium' })),
      cards,
      assets: assets.map((asset) => ({ id: String(asset.id), name: asset.name, width: asset.width, height: asset.height, size: asset.size })),
    });
  }));

  app.post('/api/dashboard/cards/:guildId', cardLimiter, route(async (req, res, { userId }) => {
    const guildId = req.params.guildId;
    const action = String(req.body?.action || '');
    const name = imageCards.normalizeName(String(req.body?.name || '').trim());
    if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
    const premium = (await getGuildPremium(guildId)).active;

    if (action === 'delete') {
      const removed = await imageCards.deleteCard(guildId, name);
      return res.status(removed ? 200 : 404).json({ ok: removed });
    }
    if (action !== 'save') return res.status(400).json({ ok: false, error: 'unknown_action' });

    const checked = normalizeCard(req.body?.data, { premium });
    if (checked.usesAdvanced && !premium) return res.status(402).json({ ok: false, error: 'premium_required', usesPremiumFont: checked.usesPremiumFont });
    const existing = await imageCards.getCard(guildId, name);
    if (!existing && (await imageCards.countCards(guildId)) >= describeLimits(premium).cards) {
      return res.status(403).json({ ok: false, error: 'card_limit', limit: describeLimits(premium).cards });
    }
    await imageCards.saveCard(guildId, name, checked.card, userId);
    res.json({ ok: true, name, card: checked.card, problems: checked.problems });
  }));

  // The preview is drawn for the person who asked, so {user.display_name} and the avatar are theirs.
  app.post('/api/dashboard/cards/:guildId/preview', cardLimiter, route(async (req, res, { guild, member }) => {
    const premium = (await getGuildPremium(guild.id)).active;
    const checked = normalizeCard(req.body?.data, { premium });
    const png = await drawCard(req.body?.data, { guild, member, user: member?.user }, { guildId: guild.id, premium });
    res.set('Content-Type', 'image/png').set('Cache-Control', 'no-store');
    res.set('X-Card-Problems', String(checked.problems.length));
    res.send(png);
  }));

  // What a card becomes once checked, including the layers a basic card builds. The advanced editor starts from it.
  app.post('/api/dashboard/cards/:guildId/normalize', cardLimiter, route(async (req, res) => {
    const premium = (await getGuildPremium(req.params.guildId)).active;
    const { card, problems } = normalizeCard(req.body?.data, { premium });
    res.json({ ok: true, card, problems });
  }));

  app.get('/api/dashboard/cards/:guildId/assets/:id', cardLimiter, route(async (req, res) => {
    const asset = await cardAssets.getAsset(req.params.guildId, req.params.id);
    if (!asset) return res.status(404).json({ ok: false, error: 'not_found' });
    res.set('Content-Type', 'image/png').set('Cache-Control', 'private, max-age=300');
    res.send(asset.bytes);
  }));

  app.delete('/api/dashboard/cards/:guildId/assets/:id', cardLimiter, route(async (req, res) => {
    const removed = await cardAssets.deleteAsset(req.params.guildId, req.params.id);
    res.status(removed ? 200 : 404).json({ ok: removed });
  }));

  // The picture arrives as the raw body, with the file name in the query, so it never goes through the small JSON limit.
  const checkAccess = async (req, res, next) => {
    const access = await authorize(req, res);
    if (access) next();
  };
  app.post('/api/dashboard/cards/:guildId/assets', uploadLimiter, checkAccess, express.raw({ type: () => true, limit: UPLOAD.bytes }), route(async (req, res, { userId }) => {
    const guildId = req.params.guildId;
    const premium = (await getGuildPremium(guildId)).active;
    const limits = describeLimits(premium);
    const mime = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!MIMES.has(mime)) return res.status(415).json({ ok: false, error: 'unsupported_type' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false, error: 'empty_file' });
    if ((await cardAssets.countAssets(guildId)) >= limits.assets) return res.status(403).json({ ok: false, error: 'asset_limit', limit: limits.assets });
    let clean;
    try { clean = await cleanUpload(req.body); } catch { return res.status(400).json({ ok: false, error: 'not_an_image' }); }
    if ((await cardAssets.totalBytes(guildId)) + clean.bytes.length > limits.storageBytes) return res.status(403).json({ ok: false, error: 'storage_full', limit: limits.storageBytes });
    const name = String(req.query.name || 'image').replace(/[^\w .-]/g, '_').slice(0, 60) || 'image';
    const row = await cardAssets.addAsset(guildId, { name, mime: 'image/png', width: clean.width, height: clean.height, bytes: clean.bytes }, userId);
    res.json({ ok: true, asset: { id: String(row.id), name: row.name, width: row.width, height: row.height, size: row.size } });
  }));
}

module.exports = { registerCardRoutes, describeLimits, cleanUpload, UPLOAD };
