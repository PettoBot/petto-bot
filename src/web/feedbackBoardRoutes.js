// i18n-ignore-file: HTTP answers for the website, no text anybody reads
// The feedback board of the website (petto.sbs/feedback) asks the bot to keep the Discord card of a post (feedback/service.js):
//   POST /api/feedback/card/publish { post: { id } }  -> { ok, channelId, messageId }   sends the card
//   POST /api/feedback/card/update  { post: { id } }  -> { ok, channelId, messageId }   draws it again (publishes it if it is gone)
//   POST /api/feedback/card/remove  { post: { id, discord_channel_id, discord_message_id } } -> { ok }   deletes it
//   POST /api/feedback/card/republish {}              -> { ok, started }                 draws every card again as Petto's own, in the background
//        (once, after the old `feed` bot is turned off: its cards cannot be edited and its buttons stop answering)
// The same key as the other dashboard routes. The post is read again from the database, so the card always shows what is saved.
const db = require('../db/feedback');
const service = require('../feedback/service');
const logger = require('../utils/logger');

const ACTIONS = new Set(['publish', 'update', 'remove', 'republish']);
let republishing = false;

/** Does the work of a request; returns `{ status, body }`. `deps` lets a test replace the database and Discord. */
async function handleCard(client, action, body, deps = {}) {
  const store = deps.db ?? db;
  const board = deps.service ?? service;
  if (!ACTIONS.has(action)) return { status: 404, body: { ok: false, error: 'not_found' } };
  if (!board.enabled()) return { status: 503, body: { ok: false, error: 'off' } };
  if (action === 'republish') {
    if (republishing) return { status: 200, body: { ok: true, started: false } };
    republishing = true;
    Promise.resolve(board.republishAll(client)).then((count) => logger.info(`The feedback board drew ${count} cards again.`)).catch((error) => logger.warn(`The feedback cards could not be drawn again: ${error.message}`)).finally(() => { republishing = false; });
    return { status: 200, body: { ok: true, started: true } };
  }
  const id = Number(body?.post?.id);
  if (!Number.isSafeInteger(id) || id < 1) return { status: 400, body: { ok: false, error: 'invalid' } };
  try {
    if (action === 'remove') {
      // The post may already be gone from the database: the website sends what it knew of it.
      const fresh = await store.getPost(id);
      await board.remove(client, fresh ?? { id, discord_channel_id: body.post.discord_channel_id, discord_message_id: body.post.discord_message_id });
      return { status: 200, body: { ok: true, channelId: null, messageId: null } };
    }
    const post = await store.getPost(id);
    if (!post) return { status: 404, body: { ok: false, error: 'not_found' } };
    const sent = action === 'publish' ? await board.publish(client, post) : await board.update(client, post);
    return { status: 200, body: { ok: true, channelId: sent?.channelId ?? null, messageId: sent?.messageId ?? null } };
  } catch (error) {
    logger.warn(`The feedback card ${action} failed for post ${id}: ${error.message}`);
    return { status: 502, body: { ok: false, error: 'discord' } };
  }
}

function registerFeedbackBoardRoutes(app, { isAuthorized, limiter, client }) {
  const middleware = limiter ? [limiter] : [];
  app.post('/api/feedback/card/:action', ...middleware, async (req, res) => {
    if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    const result = await handleCard(client, String(req.params.action), req.body);
    res.status(result.status).json(result.body);
  });
}

module.exports = { registerFeedbackBoardRoutes, handleCard };
