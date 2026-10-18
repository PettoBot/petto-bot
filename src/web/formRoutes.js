// Forms (applications) from the dashboard. The forms themselves are saved by the dashboard straight in the database; these two
// need the bot: accept or deny a submission (roles, the DM, the card in Discord) and post a panel.
//   POST /api/dashboard/guild/:guildId/forms/review  { number, status: accepted|denied, reason }
//   POST /api/dashboard/guild/:guildId/forms/submissions { status: pending|accepted|denied|cancelled|all, form_id, q, limit }
//        -> { ok, submissions, pending: { <form id>: n }, stored, cap, retention_days }
//   POST /api/dashboard/guild/:guildId/forms/panel   { form_ids: [..], channel_id, style: buttons|select, template, title, description, web }
// Filling a form on the website (petto.sbs/form/<public id>), for any member of the server who logged in with Discord. `:formId` is
// the random public id of the form (never its number, so the forms cannot be walked through):
//   POST /api/dashboard/form/:formId/public  { user_id } -> { ok, form, server, can, reason }
//   POST /api/dashboard/form/:formId/submit  { user_id, values: { <question id>: text | [values] } } -> { ok, message } or { ok: false, errors }
//   POST /api/dashboard/form/:formId/look    {} -> { ok, form: { id, title, description, color, page, embed }, server: { id, name, icon } }
//        Only how the page looks, without a member: for the page before the member logs in and for the link preview of
//        petto.sbs/form/<public id> in Discord and other apps. A form that cannot be filled on the web is not found.
// The submission goes through the same checks and the same pipeline as a Discord one (card, roles, DM, log, limits), marked "web".
// The same access as the other dashboard routes: the dashboard key and a `user_id` who can manage the server, or whose roles open the
// Forms page through "Dashboard access" (checked again by the bot, see dashboardRoleAccess.js; the list only needs to look).
const formsDb = require('../db/forms');
const { getGuildPremium } = require('../db/premium');
const forms = require('../utils/forms');
const { reviewSubmission, postPanel, storageCap, submitForm, submittedText, fetchMember } = require('../utils/formActions');
const logger = require('../utils/logger');
const { t, requestLanguage } = require('../i18n');

const SNOWFLAKE = /^\d{15,25}$/;

/** A text of Discord for a web page: role and member mentions become names, timestamps a date. */
function plainText(text, guild, lang) {
  const locale = lang === 'pt-BR' ? 'pt-BR' : lang === 'es' ? 'es' : 'en';
  return String(text ?? '')
    .replace(/<@&(\w+)>/g, (_m, id) => `@${guild?.roles?.cache?.get(id)?.name ?? id}`)
    .replace(/<#(\w+)>/g, (_m, id) => `#${guild?.channels?.cache?.get(id)?.name ?? id}`)
    .replace(/<@!?(\w+)>/g, (_m, id) => `@${guild?.members?.cache?.get(id)?.displayName ?? id}`)
    .replace(/<t:(\d+)(?::[a-zA-Z])?>/g, (_m, s) => `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(Number(s) * 1000))} UTC`);
}

/** The server as the page shows it: its name and its icon (the header and the icon of the tab). */
function publicServer(guild) {
  return { id: guild.id, name: guild.name, icon: guild.iconURL?.({ size: 256, extension: 'png' }) ?? null };
}

/** What the page of a form shows before the questions: title, description, accent color and the look of the page. */
async function formLook(form) {
  // The Premium looks (an animated background, the Petto line hidden) only show while the server has Premium.
  const premium = (await getGuildPremium(form.guild_id).catch(() => ({ active: false }))).active;
  return { id: String(form.public_id), title: form.title, description: form.description ?? null, color: form.color ?? null, page: forms.pageLook(form, { premium }), embed: forms.linkEmbed(form) };
}

/** The form as the page shows it: no review settings, no roles, only what a member reads. */
async function publicForm(form) {
  return {
    ...(await formLook(form)),
    questions: forms.normalizeQuestions(form.questions).map((q) => ({ id: q.id, type: q.type, label: q.label, help: q.help ?? null, description: q.description ?? null, image: q.image ?? null, placeholder: q.placeholder ?? null, required: q.required, min_length: q.min_length ?? null, max_length: q.max_length ?? null, min_value: q.min_value ?? null, max_value: q.max_value ?? null, options: q.options ?? [], max_choices: q.max_choices ?? null })),
  };
}

/** The form, its server and the member, or an answer already sent. */
async function webContext(req, res, client, lang0) {
  const form = await formsDb.getFormByPublicId(req.params.formId);
  const guild = form ? client?.guilds?.cache?.get(form.guild_id) : null;
  if (!form || !guild) { res.status(404).json({ ok: false, code: 'not_found', message: t(lang0, 'forms.web.notFound') }); return null; }
  const lang = requestLanguage(req, guild.id);
  const member = await fetchMember(guild, String(req.body?.user_id ?? ''));
  return { form, guild, member, lang };
}

async function eligibility(form, guild, member) {
  if (!member) return { code: 'notMember', vars: {} };
  const [stats, total] = await Promise.all([formsDb.memberStats(guild.id, form.id, member.id), form.max_total > 0 ? formsDb.countFormSubmissions(guild.id, form.id) : 0]);
  return forms.checkEligibility(form, member, stats, { total, web: true });
}

function registerFormRoutes(app, { authorize, limiter, isAuthorized = null, client = null }) {
  const middleware = limiter ? [limiter] : [];

  if (isAuthorized) {
    const webRoute = (name, handler) => app.post(`/api/dashboard/form/:formId/${name}`, ...middleware, async (req, res) => {
      if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
      if (!/^\d{15,25}$/.test(String(req.body?.user_id ?? ''))) { res.status(400).json({ ok: false, error: 'missing_identity' }); return; }
      const lang0 = requestLanguage(req, null);
      try {
        const context = await webContext(req, res, client ?? req.app?.locals?.client, lang0);
        if (context) await handler(req, res, context);
      } catch (err) {
        logger.error(`Web form ${name} failed for form ${req.params.formId}:`, err);
        res.status(500).json({ ok: false, message: t(lang0, 'forms.web.failed') });
      }
    });

    webRoute('public', async (req, res, { form, guild, member, lang }) => {
      const refusal = await eligibility(form, guild, member);
      res.set('Cache-Control', 'no-store'); // i18n-ignore: HTTP header
      res.json({
        ok: true, form: await publicForm(form), server: publicServer(guild),
        can: !refusal, code: refusal?.code ?? null, reason: refusal ? plainText(forms.refusalText(refusal, lang), guild, lang) : null,
      });
    });

    app.post('/api/dashboard/form/:formId/look', ...middleware, async (req, res) => {
      if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
      const lang = requestLanguage(req, null);
      try {
        const form = await formsDb.getFormByPublicId(req.params.formId);
        const guild = form ? (client ?? req.app?.locals?.client)?.guilds?.cache?.get(form.guild_id) : null;
        if (!form || !guild || form.web_enabled === false) { res.status(404).json({ ok: false, code: 'not_found', message: t(lang, 'forms.web.notFound') }); return; }
        res.set('Cache-Control', 'no-store'); // i18n-ignore: HTTP header
        res.json({ ok: true, form: await formLook(form), server: publicServer(guild) });
      } catch (err) {
        logger.error(`Web form look failed for form ${req.params.formId}:`, err);
        res.status(500).json({ ok: false, message: t(lang, 'forms.web.failed') });
      }
    });

    webRoute('submit', async (req, res, { form, guild, member, lang }) => {
      const refusal = await eligibility(form, guild, member);
      if (refusal) { res.status(403).json({ ok: false, code: refusal.code, message: plainText(forms.refusalText(refusal, lang), guild, lang) }); return; }
      const { values, errors } = forms.readAll(form, req.body?.values);
      if (errors.length) {
        res.status(400).json({ ok: false, code: 'invalid', errors: errors.map((e) => ({ id: e.id, code: e.code, message: t(lang, `forms.error.${e.code}`, e.vars) })) });
        return;
      }
      const result = await submitForm({ client: guild.client, guild, form, member, answers: forms.collectAnswers(form, values), source: 'web' });
      if (!result.ok) {
        const message = result.error === 'refused' ? forms.refusalText(result.refusal, lang) : t(lang, `forms.submitError.${result.error === 'missing' ? 'missing' : result.error === 'no_channel' ? 'noChannel' : result.error === 'full' ? 'full' : 'failed'}`);
        res.status(result.error === 'refused' ? 403 : 409).json({ ok: false, code: result.error, message: plainText(message, guild, lang) });
        return;
      }
      res.json({ ok: true, number: result.submission.number, message: plainText(await submittedText(guild, form, result.submission, member, lang), guild, lang) });
    });
  }

  app.post('/api/dashboard/guild/:guildId/forms/submissions', ...middleware, async (req, res) => {
    const access = await authorize(req, res, { page: 'forms', edit: false });
    if (!access) return;
    const lang = requestLanguage(req, access.guild.id);
    try {
      const guildId = access.guild.id;
      const asked = String(req.body?.status ?? 'pending');
      const status = ['pending', 'accepted', 'denied', 'cancelled'].includes(asked) ? asked : null;
      const formId = /^\d{1,15}$/.test(String(req.body?.form_id ?? '')) ? String(req.body.form_id) : null;
      const q = String(req.body?.q ?? '').trim().slice(0, 60);
      const byId = SNOWFLAKE.test(q) ? q : null;
      const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 50));
      // The reads do not depend on each other, so they go at once (the page waited for each one in turn).
      const [found, waiting, stored, cap, setting] = await Promise.all([
        formsDb.listSubmissions(guildId, { formId, status, userId: byId, limit: q && !byId ? 200 : limit }),
        formsDb.listSubmissions(guildId, { status: 'pending', limit: 200 }),
        formsDb.countStored(guildId), storageCap(guildId), formsDb.getFormConfig(guildId),
      ]);
      let rows = found;
      if (q && !byId) {
        const needle = q.toLowerCase().replace(/^#/, '');
        rows = rows.filter((row) => String(row.username ?? '').toLowerCase().includes(needle) || String(row.number) === needle).slice(0, limit);
      }
      const pending = {};
      for (const row of waiting) pending[String(row.form_id)] = (pending[String(row.form_id)] ?? 0) + 1;
      res.set('Cache-Control', 'no-store'); // i18n-ignore: HTTP header
      res.json({ ok: true, submissions: rows, pending, stored: stored.total, cap, retention_days: setting.retention_days });
    } catch (err) {
      logger.error(`Dashboard form submissions failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, message: t(lang, 'web.api.forms.failed') });
    }
  });

  app.post('/api/dashboard/guild/:guildId/forms/review', ...middleware, async (req, res) => {
    const access = await authorize(req, res, { page: 'forms', edit: true });
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
    const access = await authorize(req, res, { page: 'forms', edit: true });
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

module.exports = { registerFormRoutes, publicForm, formLook };
