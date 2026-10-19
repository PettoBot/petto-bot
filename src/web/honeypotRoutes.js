// The Honeypot from the dashboard. The dashboard reads the bait channels and the catches straight from the database; what changes
// Discord (the warning panel in the channel) goes through these routes, with the same checks as `!honeypot`:
//   POST /api/dashboard/guild/:guildId/honeypot/add     { channel_id, punishment }  a new bait channel, or a new punishment for one;
//        its panel is posted (or updated) at once
//   POST /api/dashboard/guild/:guildId/honeypot/remove  { channel_id }  the honeypot stops and its panel is removed when possible
//   POST /api/dashboard/guild/:guildId/honeypot/panel   { channel_id, mode, text, template }  what is posted in the channel:
//        `default` (Petto's panel), `custom` (the text and/or a saved embed) or `none`; posted again at once
//   POST /api/dashboard/guild/:guildId/honeypot/post    { channel_id, fresh }  posts the panel again (`fresh`: a new message at the bottom)
// Access: the dashboard key and a `user_id` who manages the server, like the other routes, and Administrator, like the command.
// Every answer is `{ ok, message, code?, honeypot? }`, the message in the language of the request.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { PUNISHMENTS, getHoneypot, upsertHoneypot, setPanelSettings, setPanelMessage, removeHoneypot } = require('../db/honeypot');
const { getTemplate } = require('../db/embedTemplates');
const { ensureGuild } = require('../db/guilds');
const { createOrUpdatePanel, deletePanel, invalidateHoneypotCache } = require('../utils/honeypot');
const logger = require('../utils/logger');
const { t, requestLanguage, guildLanguage } = require('../i18n');

const SNOWFLAKE = /^\d{15,25}$/;
const ACTIONS = new Set(['add', 'remove', 'panel', 'post']);
const CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
// The same permissions `!honeypot add` asks for in the bait channel.
const NEEDED = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
  ['ManageMessages', PermissionFlagsBits.ManageMessages],
];

/** What the dashboard needs of a row (the panel message id says whether something is posted). */
function shape(row) {
  if (!row) return null;
  return {
    channel_id: row.channel_id, punishment: row.punishment, caught_count: Math.max(0, Number(row.caught_count) || 0),
    panel_mode: row.panel_mode ?? 'default', panel_text: row.panel_text ?? '', panel_template: row.panel_template ?? null,
    panel_message_id: row.panel_message_id ?? null,
  };
}

/** The permissions the bot is missing in the channel, by name (empty when it has them all). */
function missingPermissions(channel, me) {
  const permissions = me ? channel.permissionsFor(me) : null;
  return NEEDED.filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
}

async function findChannel(guild, channelId) {
  if (!SNOWFLAKE.test(String(channelId ?? ''))) return null;
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
  return channel && channel.guildId === guild.id ? channel : null;
}

function registerHoneypotRoutes(app, { authorize, limiter }) {
  const middleware = limiter ? [limiter] : [];
  app.post('/api/dashboard/guild/:guildId/honeypot/:action', ...middleware, async (req, res) => {
    const action = String(req.params.action);
    if (!ACTIONS.has(action)) { res.status(404).json({ ok: false, error: 'unknown_action' }); return; }
    const access = await authorize(req, res);
    if (!access) return;
    const lang = requestLanguage(req, access.guild.id);
    const fail = (status, code, key, vars) => res.status(status).json({ ok: false, code, message: t(lang, `web.api.honeypot.${key}`, vars) });
    // The command is for administrators (its default permission), so its routes are too.
    if (!access.member?.permissions?.has(PermissionFlagsBits.Administrator)) { fail(403, 'admin_only', 'adminOnly'); return; }

    const { guild } = access;
    const body = req.body ?? {};
    try {
      const channel = await findChannel(guild, String(body.channel_id ?? ''));
      // The panel is drawn in the language of the server, as it is for everyone in the channel.
      const panelLang = await guildLanguage(guild.id);

      if (action === 'add') {
        if (!channel || !CHANNEL_TYPES.has(channel.type)) { fail(400, 'bad_channel', 'pickChannel'); return; }
        const punishment = body.punishment == null || body.punishment === '' ? 'softban' : String(body.punishment);
        if (!PUNISHMENTS.includes(punishment)) { fail(400, 'bad_punishment', 'badPunishment'); return; }
        const missing = missingPermissions(channel, guild.members.me);
        if (missing.length) {
          fail(400, 'missing_permissions', 'permissions', { channel: `#${channel.name}`, permissions: missing.map((name) => t(lang, `core.perm.${name}`)).join(', ') });
          return;
        }
        await ensureGuild(guild.id);
        const existed = Boolean(await getHoneypot(guild.id, channel.id));
        const row = await upsertHoneypot(guild.id, channel.id, punishment);
        invalidateHoneypotCache(guild.id);
        const configured = await createOrUpdatePanel(guild.client, channel, row, panelLang);
        res.json({ ok: true, message: t(lang, existed ? 'web.api.honeypot.updated' : 'web.api.honeypot.added', { channel: `#${channel.name}` }), honeypot: shape(configured) });
        return;
      }

      const channelId = channel?.id ?? (SNOWFLAKE.test(String(body.channel_id ?? '')) ? String(body.channel_id) : null);
      const existing = channelId ? await getHoneypot(guild.id, channelId) : null;
      if (!existing) { fail(404, 'not_honeypot', 'notHoneypot'); return; }

      if (action === 'remove') {
        // A channel deleted in Discord can still be taken off the list.
        await deletePanel(guild.client, existing);
        await removeHoneypot(guild.id, existing.channel_id);
        invalidateHoneypotCache(guild.id);
        res.json({ ok: true, message: t(lang, 'web.api.honeypot.removed') });
        return;
      }

      if (!channel) { fail(400, 'channel_gone', 'channelGone'); return; }

      if (action === 'panel') {
        const mode = String(body.mode ?? '').trim().toLowerCase();
        if (!['default', 'custom', 'none'].includes(mode)) { fail(400, 'bad_mode', 'badMode'); return; }
        const changes = { panel_mode: mode };
        if (typeof body.text === 'string') changes.panel_text = body.text.trim().slice(0, 2000);
        if ('template' in body) {
          const template = String(body.template ?? '').trim();
          if (!template) changes.panel_template = null;
          else if (!(await getTemplate(guild.id, template).catch(() => null))?.data) { fail(400, 'no_embed', 'noEmbed', { name: template }); return; }
          else changes.panel_template = template;
        }
        const text = 'panel_text' in changes ? changes.panel_text : existing.panel_text;
        const template = 'panel_template' in changes ? changes.panel_template : existing.panel_template;
        if (mode === 'custom' && !text && !template) { fail(400, 'custom_empty', 'customEmpty'); return; }
        if (mode !== 'none' && missingPermissions(channel, guild.members.me).length) {
          fail(400, 'missing_permissions', 'permissions', { channel: `#${channel.name}`, permissions: missingPermissions(channel, guild.members.me).map((name) => t(lang, `core.perm.${name}`)).join(', ') });
          return;
        }
        const row = await setPanelSettings(guild.id, existing.channel_id, changes);
        invalidateHoneypotCache(guild.id);
        const configured = await createOrUpdatePanel(guild.client, channel, row, panelLang);
        res.json({ ok: true, message: t(lang, `web.api.honeypot.panel.${mode}`, { channel: `#${channel.name}` }), honeypot: shape(configured) });
        return;
      }

      // post
      if ((existing.panel_mode ?? 'default') === 'none') { fail(400, 'nothing_to_post', 'nothingToPost'); return; }
      const missing = missingPermissions(channel, guild.members.me);
      if (missing.length) {
        fail(400, 'missing_permissions', 'permissions', { channel: `#${channel.name}`, permissions: missing.map((name) => t(lang, `core.perm.${name}`)).join(', ') });
        return;
      }
      let row = existing;
      if (body.fresh === true && existing.panel_message_id) {
        // A new message at the bottom of the channel: the old one goes away first.
        await deletePanel(guild.client, existing);
        row = await setPanelMessage(guild.id, existing.channel_id, null);
      }
      const configured = await createOrUpdatePanel(guild.client, channel, row, panelLang);
      res.json({ ok: true, message: t(lang, 'web.api.honeypot.posted', { channel: `#${channel.name}` }), honeypot: shape(configured) });
    } catch (err) {
      logger.error(`Dashboard honeypot ${action} failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, code: 'failed', message: t(lang, 'web.api.honeypot.failed') });
    }
  });
}

module.exports = { registerHoneypotRoutes, missingPermissions, shape };
