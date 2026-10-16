// POST /api/dashboard/guild/:guildId/members with `{ "ids": ["<user id>", ...] }` (at most 100 snowflakes) answers
// `{ ok: true, members: { "<id>": { id, username, globalName, displayName, avatar, bot } } }`, leaving out the ids that are not
// members. The same access as the other dashboard routes of a server: the `x-petto-dashboard-key` header and a `user_id` (query or
// body) who can manage the server. One call counts once against the per-IP limit, however many ids it carries.
const { parseMemberIds, lookupMembers, searchMembers } = require('../utils/dashboardMembers');
const logger = require('../utils/logger');

function registerMemberRoutes(app, { isAuthorized, authorize, limiter }) {
  const middleware = limiter ? [limiter] : [];
  app.post('/api/dashboard/guild/:guildId/members', ...middleware, async (req, res) => {
    // The key and the body are checked before anything is asked of Discord.
    if (!isAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    const parsed = parseMemberIds(req.body?.ids);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: parsed.error });
      return;
    }
    const access = await authorize(req, res);
    if (!access) return;
    try {
      const members = parsed.ids.length ? await lookupMembers(access.guild, parsed.ids) : {};
      res.set('Cache-Control', 'private, max-age=60'); // i18n-ignore: HTTP header
      res.json({ ok: true, members });
    } catch (err) {
      logger.error(`Dashboard member lookup failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, error: 'members_failed' });
    }
  });

  // POST .../members/search with `{ "query": "ana" }`: up to 10 members whose name starts with it, for the dashboard's "pick a person" boxes.
  app.post('/api/dashboard/guild/:guildId/members/search', ...middleware, async (req, res) => {
    if (!isAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    const access = await authorize(req, res);
    if (!access) return;
    try {
      res.json({ ok: true, members: await searchMembers(access.guild, req.body?.query) });
    } catch (err) {
      logger.error(`Dashboard member search failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, error: 'members_failed' });
    }
  });
}

module.exports = { registerMemberRoutes };
