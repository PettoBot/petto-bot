// Paginated messages from the Embeds page of the dashboard. The dashboard reads the list straight from the database
// (`pagination_messages`); what changes Discord goes through these routes, with the same checks as `!pagination`:
//   POST /api/dashboard/guild/:guildId/pagination/create   { channel_id, embeds: [name, ...], private }  posts a new message whose
//        pages are those saved embeds, in that order (1 to 25, all classic embeds or all Components V2)
//   POST /api/dashboard/guild/:guildId/pagination/delete   { id, purge }  stops it and takes its buttons off (`purge`: deletes the message)
//   POST /api/dashboard/guild/:guildId/pagination/restore  { id }  shows page 1 again with its buttons
// Access: the dashboard key and a `user_id` who manages the server (or has the Embeds page by role), like the other routes, and
// Manage Messages, like the command. Every answer is `{ ok, message, code?, pagination? }`, the message in the language of the request.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../db/paginations');
const { getTemplate } = require('../db/embedTemplates');
const { ensureGuild } = require('../db/guilds');
const { guildLimit } = require('../db/premium');
const { MAX_PAGES, sourceFromInput, checkPage, mixingProblem, messageLink } = require('../utils/pagination');
const { postPagination, showPage, stripButtons, fetchRecordMessage, pageContext } = require('../utils/paginationActions');
const logger = require('../utils/logger');
const { t, requestLanguage, guildLanguage } = require('../i18n');

const SNOWFLAKE = /^\d{15,25}$/;
const ACTIONS = new Set(['create', 'delete', 'restore']);
const CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread, ChannelType.GuildVoice]);

/** What the dashboard needs of a record. */
function shape(row) {
  if (!row) return null;
  return {
    id: String(row.id), channel_id: row.channel_id, message_id: row.message_id, kind: row.kind, private: row.private === true,
    pages: (row.pages ?? []).length, url: messageLink(row),
  };
}

function registerPaginationRoutes(app, { authorize, limiter }) {
  const middleware = limiter ? [limiter] : [];
  app.post('/api/dashboard/guild/:guildId/pagination/:action', ...middleware, async (req, res) => {
    const action = String(req.params.action);
    if (!ACTIONS.has(action)) { res.status(404).json({ ok: false, error: 'unknown_action' }); return; }
    const access = await authorize(req, res, { page: 'embeds' });
    if (!access) return;
    const lang = requestLanguage(req, access.guild.id);
    const fail = (status, code, key, vars) => res.status(status).json({ ok: false, code, message: t(lang, `web.api.pagination.${key}`, vars) });
    const failWith = (status, result) => {
      const vars = { ...(result.vars ?? {}) };
      if (Array.isArray(vars.permissions)) vars.permissions = vars.permissions.map((name) => t(lang, `core.perm.${name}`)).join(', ');
      res.status(status).json({ ok: false, code: result.error, message: t(lang, `pagination.error.${result.error}`, vars) });
    };
    // The command needs Manage Messages, so its routes do too.
    if (!access.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) { fail(403, 'no_permission', 'manageMessages'); return; }

    const { guild } = access;
    const body = req.body ?? {};
    try {
      // The message is drawn in the language of the server, as it is for everyone in the channel.
      const messageLang = await guildLanguage(guild.id);

      if (action === 'create') {
        const channelId = String(body.channel_id ?? '');
        const channel = SNOWFLAKE.test(channelId) ? guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null) : null;
        if (!channel || !CHANNEL_TYPES.has(channel.type) || !channel.messages) { fail(400, 'bad_channel', 'pickChannel'); return; }
        const names = (Array.isArray(body.embeds) ? body.embeds : []).map((name) => String(name ?? '').trim()).filter(Boolean);
        if (!names.length) { fail(400, 'no_pages', 'pickEmbeds'); return; }
        if (names.length > MAX_PAGES) { fail(400, 'too_many', 'tooMany', { max: MAX_PAGES }); return; }
        const allowed = await guildLimit(guild.id, 'paginationMessages');
        if ((await db.countPaginations(guild.id)) >= allowed.limit) {
          fail(400, 'limit', allowed.premium ? 'limit' : 'limitFree', { limit: allowed.limit, premium: allowed.premiumLimit });
          return;
        }
        const ctx = pageContext(guild, channel, access.member, messageLang);
        const pages = [];
        let kind = null;
        for (const [index, name] of names.entries()) {
          // A name with spaces or braces would be read as a code: the dashboard only sends names of saved embeds.
          if (/\s|\{|\}/.test(name)) { fail(400, 'no_embed', 'noEmbed', { name }); return; }
          const found = await sourceFromInput(name, { guildId: guild.id, lang, getTemplate });
          if (found.error) { failWith(400, found); return; }
          const mixed = mixingProblem(kind, found.kind);
          if (mixed) { fail(400, 'mixed', 'mixed', { page: index + 1 }); return; }
          kind = found.kind;
          const problem = await checkPage(found, ctx);
          if (problem) { failWith(400, problem); return; }
          pages.push(found.source);
        }
        await ensureGuild(guild.id);
        const posted = await postPagination(channel, { pages, kind, isPrivate: body.private === true, member: access.member, lang: messageLang });
        if (posted.error) { failWith(400, posted); return; }
        res.json({ ok: true, message: t(lang, 'web.api.pagination.posted', { channel: `#${channel.name}`, count: pages.length }), pagination: shape(posted.record) });
        return;
      }

      const record = /^\d{1,19}$/.test(String(body.id ?? '')) ? await db.getPagination(String(body.id)) : null;
      if (!record || record.guild_id !== guild.id) { fail(404, 'not_found', 'notFound'); return; }

      if (action === 'delete') {
        if (body.purge === true) {
          const found = await fetchRecordMessage(guild.client, record);
          if (found.message) await found.message.delete().catch(() => null);
        } else {
          await stripButtons(guild.client, record);
        }
        await db.deletePagination(record);
        res.json({ ok: true, message: t(lang, body.purge === true ? 'web.api.pagination.deletedMessage' : 'web.api.pagination.deleted') });
        return;
      }

      // restore
      const shown = await showPage(guild.client, record, 0, { lang: messageLang });
      if (shown.error === 'gone') { fail(404, 'gone', 'gone'); return; }
      if (shown.error) { failWith(400, shown); return; }
      res.json({ ok: true, message: t(lang, 'web.api.pagination.restored'), pagination: shape(record) });
    } catch (err) {
      logger.error(`Dashboard pagination ${action} failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, code: 'failed', message: t(lang, 'web.api.pagination.failed') });
    }
  });
}

module.exports = { registerPaginationRoutes, shape };
