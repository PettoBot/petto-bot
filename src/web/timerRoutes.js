// "Send now" of a timer in the dashboard (Automation, Timers), the same as `!timer run`:
//   POST /api/dashboard/guild/:guildId/timers/:timerId/run   {}   sends the timer's message now; its schedule does not change
// `:timerId` is the row's id (the dashboard keeps it; members see the number). Access: the dashboard key and a `user_id` who manages the
// server, or a role with edit access to Automation. The answer is `{ ok, message, code?, error? }`, the message in the request's language;
// a send Discord refused gives `error` (also kept in the timer's `last_error`).
const autoMessagesDb = require('../db/autoMessages');
const logger = require('../utils/logger');
const { t, requestLanguage } = require('../i18n');

function registerTimerRoutes(app, { authorize, limiter, send = null }) {
  const middleware = limiter ? [limiter] : [];
  app.post('/api/dashboard/guild/:guildId/timers/:timerId/run', ...middleware, async (req, res) => {
    const access = await authorize(req, res, { page: 'automation', edit: true });
    if (!access) return;
    const { guild } = access;
    const lang = requestLanguage(req, guild.id);
    const id = String(req.params.timerId);
    if (!/^\d{1,18}$/.test(id)) { res.status(400).json({ ok: false, code: 'bad_timer', message: t(lang, 'web.api.timers.notFound') }); return; }
    try {
      const timer = await autoMessagesDb.get(guild.id, id);
      if (!timer) { res.status(404).json({ ok: false, code: 'not_found', message: t(lang, 'web.api.timers.notFound') }); return; }
      const sendTimer = send ?? require('../jobs/autoMessageJob').sendTimer;
      const result = await sendTimer(guild.client, timer);
      const number = timer.number ?? timer.id;
      if (!result.ok) { res.status(502).json({ ok: false, code: 'send_failed', error: result.error, message: t(lang, 'web.api.timers.failed', { number, error: result.error }) }); return; }
      res.json({ ok: true, message: t(lang, 'web.api.timers.sent', { number }) });
    } catch (err) {
      logger.error(`Dashboard timer run failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, code: 'failed', message: t(lang, 'web.api.timers.notFound') });
    }
  });
}

module.exports = { registerTimerRoutes };
