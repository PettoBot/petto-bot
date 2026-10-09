// The routes the dashboard uses for Vanity and Server Tag rules: one read with everything a page needs (rules, thank-you
// messages, log, roles, channels, saved embeds) and one write that takes an action. Every write goes through utils/identity/rules.js,
// the same checks the commands use, and leaves a row in the audit trail with who did it.
const { rateLimit } = require('express-rate-limit');
const { ChannelType } = require('discord.js');
const db = require('../db/identity');
const { ensureGuild } = require('../db/guilds');
const { listTemplates, getTemplate } = require('../db/embedTemplates');
const rules = require('../utils/identity/rules');
const { LOG_EVENTS } = require('../utils/identity/emit');
const { VANITY_SOURCES, COMPARISONS, CONDITIONS, ACTIONS } = require('../utils/identity/compare');
const { VARIABLE_GROUPS } = require('../utils/embedVariableRegistry');
const logger = require('../utils/logger');

const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
const writes = new Map();
const WRITES_PER_MINUTE = 40;
const STATUS = { invalid_rule: 400, invalid_name: 400, invalid_action: 400, no_events: 400, role_not_found: 404, rule_not_found: 404, channel_not_found: 404, embed_not_found: 404, duplicate_name: 409, limit: 409, rate_limited: 429 };

function rateLimited(userId) {
  const now = Date.now();
  const recent = (writes.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= WRITES_PER_MINUTE) { writes.set(userId, recent); return true; }
  recent.push(now);
  writes.set(userId, recent);
  return false;
}

const isTextChannel = (channel) => channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type);
const failure = (res, code, message) => res.status(STATUS[code] ?? 400).json({ ok: false, error: code, message });

async function overview(guild) {
  const [vanity, guildtag, notifyVanity, notifyTag, log, templates] = await Promise.all([
    db.listVanityRules(guild.id, { all: true }), db.listGuildTagRules(guild.id, { all: true }),
    db.getNotification(guild.id, 'vanity'), db.getNotification(guild.id, 'guildtag'), db.getLogConfig(guild.id), listTemplates(guild.id),
  ]);
  const notification = (entry) => ({ channel_id: entry?.channelId ?? '', embed: entry?.embedName ?? '', ping: entry?.ping ?? 'user' });
  const group = VARIABLE_GROUPS.find((entry) => entry.id === 'identity');
  return {
    ok: true,
    guild: { id: guild.id, name: guild.name, icon: guild.icon },
    rules: { vanity, guildtag },
    notifications: { vanity: notification(notifyVanity), guildtag: notification(notifyTag) },
    logs: { channel_id: log?.channelId ?? '', events: LOG_EVENTS.filter((event) => log?.events?.[event]), embeds: log?.embeds ?? {} },
    embeds: templates.map((template) => template.name),
    variables: group ? [{ label: group.label, vars: group.vars }] : [],
    roles: [...guild.roles.cache.values()].filter((role) => role.id !== guild.id).sort((a, b) => b.position - a.position).map((role) => {
      const problem = rules.roleProblem(guild, role.id);
      return { id: role.id, name: role.name, color: role.color, position: role.position, assignable: !problem, ...(problem ? { reason: problem.code === 'role_managed' ? 'managed' : 'above_bot' } : {}) };
    }),
    channels: [...guild.channels.cache.values()].filter(isTextChannel).sort((a, b) => a.rawPosition - b.rawPosition).map((channel) => ({ id: channel.id, name: channel.name, position: channel.rawPosition })),
    options: { vanity_sources: VANITY_SOURCES, comparisons: COMPARISONS, conditions: CONDITIONS, actions: ACTIONS, log_events: LOG_EVENTS, ping_modes: ['user', 'none'] },
  };
}

/** Runs one action. Returns `{ ok: true, note? }` or `{ ok: false, code, message }`. */
async function act(guild, member, body) {
  const action = String(body.action ?? '');
  const kind = action.startsWith('vanity_') ? 'vanity' : action.startsWith('guildtag_') ? 'guildtag' : null;
  const pick = (...keys) => Object.fromEntries(keys.filter((key) => body[key] !== undefined && body[key] !== '').map((key) => [key, body[key]]));
  if (kind && action.endsWith('_create')) {
    const fields = kind === 'vanity'
      ? { ...pick('word', 'source', 'comparison', 'role_id'), action: body.rule_action, normalization: { case_fold: body.case_fold !== false, trim_space: body.trim_space !== false, collapse_space: body.collapse_space !== false } }
      : { ...pick('condition', 'value', 'role_id'), action: body.rule_action };
    const result = await rules.createRule(guild, kind, { name: body.name, ...fields }, member, member.id);
    return result.ok ? { ok: true, note: 'Members are checked as they change. Use the sync command to apply it to everyone now.' } : result;
  }
  if (kind && action.endsWith('_update')) {
    const fields = pick(...(kind === 'vanity' ? ['word', 'source', 'comparison', 'role_id'] : ['condition', 'value', 'role_id']));
    if (typeof body.enabled === 'boolean') fields.enabled = body.enabled;
    const result = await rules.updateRule(guild, kind, body.name, fields, member);
    return result.ok ? { ok: true } : result;
  }
  if (kind && action.endsWith('_delete')) return rules.removeRule(guild, kind, body.name);
  if (action === 'notify_set') {
    const source = body.notify_source === 'guildtag' ? 'guildtag' : body.notify_source === 'vanity' ? 'vanity' : null;
    if (!source) return { ok: false, code: 'invalid_action', message: 'Choose vanity or guildtag.' };
    if (!body.channel_id) { await db.clearNotification(guild.id, source); return { ok: true }; }
    const channel = guild.channels.cache.get(String(body.channel_id));
    if (!isTextChannel(channel)) return { ok: false, code: 'channel_not_found', message: 'Choose a text channel of this server.' };
    const embedName = body.embed && body.embed !== 'default' ? String(body.embed).toLowerCase() : '';
    if (embedName && !(await getTemplate(guild.id, embedName))) return { ok: false, code: 'embed_not_found', message: 'That embed does not exist.' };
    await db.setNotification(guild.id, source, { channelId: channel.id, embedName, ping: body.ping === 'none' ? 'none' : 'user' });
    return { ok: true };
  }
  if (action === 'logs_set') {
    if (!body.channel_id) { await db.clearLogConfig(guild.id); return { ok: true }; }
    const channel = guild.channels.cache.get(String(body.channel_id));
    if (!isTextChannel(channel)) return { ok: false, code: 'channel_not_found', message: 'Choose a text channel of this server.' };
    const chosen = (Array.isArray(body.events) ? body.events : []).filter((event) => LOG_EVENTS.includes(event));
    if (!chosen.length) return { ok: false, code: 'no_events', message: 'Choose at least one log event.' };
    const embeds = {};
    for (const [event, name] of Object.entries(body.embeds ?? {})) {
      if (!LOG_EVENTS.includes(event) || !name) continue;
      if (!(await getTemplate(guild.id, String(name).toLowerCase()))) return { ok: false, code: 'embed_not_found', message: 'That embed does not exist.' };
      embeds[event] = String(name).toLowerCase();
    }
    await db.setLogConfig(guild.id, { channelId: channel.id, events: Object.fromEntries(chosen.map((event) => [event, true])), embeds });
    return { ok: true };
  }
  return { ok: false, code: 'invalid_action', message: 'Unknown action.' };
}

function registerIdentityRoutes(app, { authorize }) {
  const route = (handler) => async (req, res) => {
    const access = await authorize(req, res);
    if (!access) return;
    try { await handler(req, res, access); } catch (error) {
      logger.error({ guildId: req.params.guildId, action: 'identity-route' }, `Vanity request failed: ${error.message}`);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'unavailable', message: 'Something went wrong.' });
    }
  };

  app.get('/api/dashboard/guild/:guildId/identity', limiter, route(async (req, res, { guild }) => {
    res.json(await overview(guild));
  }));

  app.post('/api/dashboard/guild/:guildId/identity', limiter, route(async (req, res, { guild, member, userId }) => {
    if (rateLimited(userId)) return failure(res, 'rate_limited', 'Too many changes, wait a minute and try again.');
    await ensureGuild(guild.id);
    const result = await act(guild, member, req.body ?? {});
    if (!result.ok) return failure(res, result.code, result.message);
    await db.recordAudit({
      eventType: `dashboard_${req.body.action}`, dedupeKey: `dashboard:${guild.id}:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      guildId: guild.id, actorId: userId, result: 'ok', metadata: { name: String(req.body.name ?? ''), action: String(req.body.action) },
    }).catch(() => {});
    res.json({ ok: true, ...(result.note ? { note: result.note } : {}) });
  }));
}

module.exports = { registerIdentityRoutes, overview, act };
