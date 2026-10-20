// The kept copies of the avatars of the profile history, for the dashboard's history page (/dash/history). The site asks with its private
// key and says who is looking (`viewer_id`, from its login); the rules are the page's: your own history always, somebody else's unless
// they turned it off. An avatar without a copy that was never tried is added to the copy queue (it may still be served by Discord).
const { rateLimit } = require('express-rate-limit');
const logger = require('../utils/logger');

const ID = /^\d{15,25}$/;
const HASH = /^(a_)?[0-9a-f]{32}$/;
// Every request comes from the site's server, and a page shows 24 avatars: a generous limit, only against a runaway loop.
const limiter = rateLimit({
  windowMs: 60_000, limit: 1200, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ ok: false, error: 'rate_limited' }); },
});

/** `images` is src/db/profileHistoryImages.js, `history` src/db/identityHistory.js, `copies` the queue of src/utils/avatarCopies.js. */
function registerHistoryImageRoutes(app, { isAuthorized, images, history, copies }) {
  app.get('/api/dashboard/history/avatar/:userId/:hash', limiter, async (req, res) => {
    if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    const userId = String(req.params.userId || '');
    const hash = String(req.params.hash || '').replace(/\.(webp|png)$/, '');
    const viewer = String(req.query.viewer_id || '');
    if (!ID.test(userId) || !HASH.test(hash) || !ID.test(viewer)) { res.status(400).json({ ok: false, error: 'invalid' }); return; }
    try {
      // Somebody else's history that is turned off is not shown, the same as on the page (and it has no copies anyway).
      if (viewer !== userId && await history.isOptedOut(userId)) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      const image = await images.get(userId, hash);
      if (!image) {
        const known = await images.status(userId, hash);
        if (!known && copies && !(await history.isOptedOut(userId)) && await images.recorded(userId, hash)) copies().enqueue(userId, hash);
        res.set('Cache-Control', 'no-store');
        res.status(404).json({ ok: false, error: known?.missing ? 'gone' : 'not_found' });
        return;
      }
      // The hash names the picture for good, so the browser may keep it; private, since who may see it can change.
      res.set('Content-Type', image.content_type);
      res.set('Content-Length', String(image.bytes.length));
      res.set('Cache-Control', 'private, max-age=31536000, immutable'); // i18n-ignore: HTTP header
      res.set('ETag', `"${hash}"`);
      res.status(200).end(image.bytes);
    } catch (err) {
      logger.error(`Profile history: could not read the avatar ${hash} of ${userId}:`, err);
      res.status(500).json({ ok: false, error: 'failed' });
    }
  });
}

module.exports = { registerHistoryImageRoutes };
