// Forms (applications) from the dashboard. The forms themselves are saved by the dashboard straight in the database; these two
// need the bot: accept or deny a submission (roles, the DM, the card in Discord) and post a panel.
//   POST /api/dashboard/guild/:guildId/forms/review  { number, status: accepted|denied, reason }
//   POST /api/dashboard/guild/:guildId/forms/panel   { form_ids: [..], channel_id, style: buttons|select, template, title, description }
// The same access as the other dashboard routes: the dashboard key and a `user_id` who can manage the server.
const formsDb = require('../db/forms');
const { reviewSubmission, postPanel } = require('../utils/formActions');
const logger = require('../utils/logger');
const { t, requestLanguage } = require('../i18n');

const SNOWFLAKE = /^\d{15,25}$/;

function registerFormRoutes(app, { authorize, limiter }) {
  const middleware = limiter ? [limiter] : [];

  app.post('/api/dashboard/guild/:guildId/forms/review', ...middleware, async (req, res) => {
    const access = await authorize(req, res);
    if (!access) return;
    const lang = requestLanguage(req, access.guild.id);
    try {
      const status = String(req.body?.status ?? '');
      if (!['accepted', 'denied'].includes(status)) { res.status(400).json({ ok: false, message: t(lang, 'web.api.forms.badStatus') }); return; }
      const submission = await formsDb.getSubmission(access.guild.id, Number(req.body?.number));
      if (!submission) { res.status(404).json({ ok: false, message: t(lang, 'web.api.forms.notFound') }); return; }
      if (submission.status !== 'pending') { res.status(409).json({ ok: false, message: t(lang, 'web.api.forms.already') }); return; }
      const result = await reviewSubmission({
        client: access.guild.client, guild: access.guild, submission, status, reason: req.body?.reason ?? null,
        reviewer: { id: access.userId, name: access.member?.displayName ?? access.member?.user?.username ?? access.userId },
      });
      if (!result.ok) { res.status(409).json({ ok: false, message: t(lang, 'web.api.forms.already') }); return; }
      res.json({ ok: true, message: t(lang, status === 'accepted' ? 'web.api.forms.accepted' : 'web.api.forms.denied', { number: submission.number }), dm: result.dm, roles: result.roles });
    } catch (err) {
      logger.error(`Dashboard form review failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, message: t(lang, 'web.api.forms.failed') });
    }
  });

  app.post('/api/dashboard/guild/:guildId/forms/panel', ...middleware, async (req, res) => {
    const access = await authorize(req, res);
    if (!access) return;
    const lang = requestLanguage(req, access.guild.id);
    try {
      const channelId = String(req.body?.channel_id ?? '');
      const channel = SNOWFLAKE.test(channelId) ? access.guild.channels.cache.get(channelId) ?? await access.guild.channels.fetch(channelId).catch(() => null) : null;
      if (!channel) { res.status(400).json({ ok: false, message: t(lang, 'web.api.forms.pickChannel') }); return; }
      const wanted = [...new Set((Array.isArray(req.body?.form_ids) ? req.body.form_ids : []).map(String))].slice(0, 25);
      const all = await formsDb.listForms(access.guild.id);
      const formList = wanted.map((id) => all.find((form) => String(form.id) === id)).filter(Boolean);
      if (!formList.length) { res.status(400).json({ ok: false, message: t(lang, 'web.api.forms.pickForms') }); return; }
      const color = /^#?[0-9a-f]{6}$/i.test(String(req.body?.color ?? '')) ? parseInt(String(req.body.color).replace('#', ''), 16) : null;
      const result = await postPanel({
        guild: access.guild, channel, formList, style: req.body?.style === 'select' ? 'select' : 'buttons',
        template: typeof req.body?.template === 'string' ? req.body.template : null, title: req.body?.title ?? null, description: req.body?.description ?? null, color, createdBy: access.userId,
      });
      if (!result.ok) { res.status(400).json({ ok: false, message: t(lang, `forms.panel.error.${result.error}`) }); return; }
      res.json({ ok: true, message: t(lang, 'web.api.forms.panelPosted'), url: result.message.url ?? null, panel_id: result.panel.id });
    } catch (err) {
      logger.error(`Dashboard form panel failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, message: t(lang, 'web.api.forms.failed') });
    }
  });
}

module.exports = { registerFormRoutes };
