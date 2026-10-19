// The case log from the dashboard (Moderation, Case log), the same as `/case edit` and `/case delete`:
//   POST /api/dashboard/guild/:guildId/cases/edit    { case, reason }  a new reason for the case
//   POST /api/dashboard/guild/:guildId/cases/delete  { case }          the case is deleted (a warning stops counting for escalation)
// Both are written to the sanctions log as the command does, with the member of the dashboard as who did it.
// Access: the dashboard key and a `user_id` who manages the server (or a role with edit access to Moderation), and Moderate Members,
// like the command. Every answer is `{ ok, message, code?, case? }`, the message in the language of the request.
const { PermissionFlagsBits } = require('discord.js');
const { getCase, updateCase, deleteCase } = require('../db/modActions');
const { typeName } = require('../utils/caseFormat');
const { handleStaffAction } = require('../logging/moreLog');
const logger = require('../utils/logger');
const { t, requestLanguage, guildLanguage } = require('../i18n');

const ACTIONS = new Set(['edit', 'delete']);
const MAX_REASON = 1000;

function registerCaseRoutes(app, { authorize, limiter, staffLog = handleStaffAction }) {
  const middleware = limiter ? [limiter] : [];
  app.post('/api/dashboard/guild/:guildId/cases/:action', ...middleware, async (req, res) => {
    const action = String(req.params.action);
    if (!ACTIONS.has(action)) { res.status(404).json({ ok: false, error: 'unknown_action' }); return; }
    const access = await authorize(req, res, { page: 'moderation', edit: true });
    if (!access) return;
    const { guild, member, userId } = access;
    const lang = requestLanguage(req, guild.id);
    const fail = (status, code, key, vars) => res.status(status).json({ ok: false, code, message: t(lang, `web.api.cases.${key}`, vars) });
    const has = (flag) => Boolean(member?.permissions?.has(flag));
    if (!has(PermissionFlagsBits.ModerateMembers) && !has(PermissionFlagsBits.Administrator)) { fail(403, 'no_permission', 'needModerate'); return; }

    const body = req.body ?? {};
    const number = Number(body.case);
    if (!Number.isInteger(number) || number < 1) { fail(400, 'bad_case', 'badCase'); return; }
    try {
      const row = await getCase(guild.id, number);
      if (!row) { fail(404, 'not_found', 'notFound', { number }); return; }
      // The log is read by the staff, in the language of the server.
      const logLang = await guildLanguage(guild.id);
      const logged = { moderator: userId, user: row.user_id ? { id: row.user_id } : null, number, type: typeName(row.type, logLang) };

      if (action === 'edit') {
        const reason = String(body.reason ?? '').replace(/\u0000/g, '').trim().slice(0, MAX_REASON);
        if (!reason) { fail(400, 'empty_reason', 'emptyReason'); return; }
        if (reason === String(row.reason ?? '')) { res.json({ ok: true, message: t(lang, 'web.api.cases.unchanged', { number }) }); return; }
        const updated = await updateCase(guild.id, number, { reason });
        staffLog('caseEdited', guild.client, guild, logged).catch(() => {});
        res.json({ ok: true, message: t(lang, 'web.api.cases.edited', { number }), case: { number, reason: updated?.reason ?? reason } });
        return;
      }

      await deleteCase(guild.id, number);
      staffLog('caseDeleted', guild.client, guild, logged).catch(() => {});
      res.json({ ok: true, message: t(lang, 'web.api.cases.deleted', { number }) });
    } catch (err) {
      logger.error(`Dashboard case ${action} failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, code: 'failed', message: t(lang, 'web.api.cases.failed') });
    }
  });
}

module.exports = { registerCaseRoutes };
