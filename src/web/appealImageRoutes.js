// The pictures of an appeal page. The dashboard uploads them (the person has to manage the server) and the site reads them
// through the same private key as the other appeal routes; the site then serves them to the public.
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const images = require('../db/appealImages');
const { UPLOAD } = require('./cardRoutes');
const { prepareImage } = require('../utils/appealImage');
const logger = require('../utils/logger');

const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const limiter = rateLimit({
  windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ ok: false, error: 'rate_limited' }); },
});

function registerAppealImageRoutes(app, { authorize, isAuthorized }) {
  const kindOf = (req, res) => {
    const kind = String(req.params.kind || '');
    if (images.KINDS.includes(kind)) return kind;
    res.status(404).json({ ok: false, error: 'unknown_kind' });
    return null;
  };

  app.post('/api/dashboard/guild/:guildId/appeals/image/:kind', limiter, async (req, res, next) => { if (await authorize(req, res)) next(); },
    express.raw({ type: () => true, limit: UPLOAD.bytes }), async (req, res) => {
      const kind = kindOf(req, res);
      if (!kind) return;
      try {
        const mime = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!MIMES.has(mime)) return res.status(415).json({ ok: false, error: 'unsupported_type' });
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false, error: 'empty_file' });
        let clean;
        try { clean = await prepareImage(req.body, kind); } catch { return res.status(400).json({ ok: false, error: 'not_an_image' }); }
        const row = await images.setImage(req.params.guildId, kind, { mime: 'image/png', width: clean.width, height: clean.height, bytes: clean.bytes });
        res.json({ ok: true, width: row.width, height: row.height, size: row.size, version: new Date(row.updated_at).getTime() });
      } catch (err) {
        logger.error(`Appeal image upload failed for guild ${req.params.guildId}:`, err);
        res.status(500).json({ ok: false, error: 'failed' });
      }
    });

  app.delete('/api/dashboard/guild/:guildId/appeals/image/:kind', limiter, async (req, res) => {
    if (!(await authorize(req, res))) return;
    const kind = kindOf(req, res);
    if (!kind) return;
    try { res.json({ ok: true, removed: await images.deleteImage(req.params.guildId, kind) }); } catch (err) {
      logger.error(`Appeal image removal failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, error: 'failed' });
    }
  });

  // What the public site shows: the bytes of one picture.
  app.get('/api/appeals/:guildId/image/:kind', limiter, async (req, res) => {
    if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const kind = kindOf(req, res);
    if (!kind || !/^\d{15,25}$/.test(String(req.params.guildId))) return;
    try {
      const image = await images.getImage(req.params.guildId, kind);
      if (!image) return res.status(404).json({ ok: false, error: 'not_found' });
      res.set('Content-Type', image.mime).set('Cache-Control', 'public, max-age=300').send(image.bytes); // i18n-ignore: HTTP header
    } catch (err) {
      logger.error(`Appeal image read failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, error: 'failed' });
    }
  });
}

module.exports = { registerAppealImageRoutes };
